import base64
import hashlib
import json
import mimetypes
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import quote

import cv2
import numpy as np
import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel


app = FastAPI(title='CP Plus Camera Helper')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

VIDEO_FILE_EXTENSIONS = {'.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv', '.dav'}
DEFAULT_CAMERA_IP = '192.168.119.205'
DEFAULT_CAMERA_USER = 'admin'
DEFAULT_CAMERA_PASSWORD = 'Admin@123'
DEFAULT_STORAGE_ROOT = r'C:\CPPLUS_RECORDINGS'
MAX_GATE_RECORD_SECONDS = 300


class CameraRequest(BaseModel):
    ip: str
    http_port: int = 80
    rtsp_port: int = 554
    username: str
    password: str
    channel: int = 1
    start_at: str | None = None
    end_at: str | None = None


class DownloadRequest(CameraRequest):
    file_path: str


class RecordingRequest(CameraRequest):
    storage_root: str = DEFAULT_STORAGE_ROOT
    max_record_seconds: int = MAX_GATE_RECORD_SECONDS
    event_type: str = 'manual'


class PlcMonitorRequest(RecordingRequest):
    plc_host: str = '192.168.117.201'
    plc_port: int = 1026
    plc_device: str = 'X'
    gate_open_addresses: list[int | str] = ['4A']
    gate_close_addresses: list[int | str] = ['4A']
    gate_open_when: bool = False
    gate_close_when: bool = True
    poll_seconds: float = 0.5
    max_record_seconds: int = MAX_GATE_RECORD_SECONDS


class RecordingIndexRequest(BaseModel):
    storage_root: str = DEFAULT_STORAGE_ROOT
    start_at: str | None = None
    end_at: str | None = None
    event_type: str | None = None
    duration_filter: str | None = None
    machine: str | None = None
    page: int = 1
    page_size: int = 50


recording_state = {
    'running': False,
    'path': None,
    'started_at': None,
    'ended_at': None,
    'duration_seconds': None,
    'error': None,
    'frames': 0,
    'url': None,
    'metadata_path': None,
    'event_type': None,
    'event_started_at': None,
    'event_ended_at': None,
    'event_duration_seconds': None,
    'auto_stopped': False,
}
recording_stop_event = threading.Event()
recording_thread: threading.Thread | None = None
recording_process: subprocess.Popen | None = None
plc_monitor_state = {
    'running': False,
    'plc_host': None,
    'plc_port': None,
    'gate_open': False,
    'gate_close': False,
    'current_event_type': None,
    'current_event_started_at': None,
    'last_action': None,
    'last_read_at': None,
    'last_error': None,
    'open_values': {},
    'close_values': {},
}
plc_monitor_stop_event = threading.Event()
plc_monitor_thread: threading.Thread | None = None


def camera_base_url(ip: str, port: int) -> str:
    port_text = '' if port == 80 else f':{port}'
    return f'http://{ip}{port_text}'


def compact_json(data: dict) -> str:
    return json.dumps(data, separators=(',', ':'))


def cpapi_post(http: requests.Session, base_url: str, body: dict, endpoint: str = '/cpapi2') -> dict:
    payload = compact_json(body)
    response = http.post(
        f'{base_url}{endpoint}',
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'ETag': hashlib.sha256(payload.encode()).hexdigest(),
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def cp_hash(name: str, value: str) -> str:
    data = value.encode()
    if name.endswith('512'):
        return hashlib.sha512(data).hexdigest().lower()
    if name.endswith('256'):
        return hashlib.sha256(data).hexdigest().lower()
    return hashlib.md5(data).hexdigest().lower()


def build_login_params(username: str, password: str, challenge: dict) -> tuple[str, dict]:
    params = challenge.get('params', {})
    realm = params.get('realm', '')
    random_value = params.get('random', '')
    encryption = params.get('encryption', 'Default')
    authority_types = params.get('authorityType') or []
    selected_authority = next(
        (item for suffix in ('512', '256') for item in authority_types if item.endswith(suffix)),
        None,
    )

    if selected_authority:
        qop = (params.get('qop') or ['auth'])[0]
        cnonce = secrets.token_hex(16)
        nc = '00000001'
        first = cp_hash(selected_authority, f'{username}:{realm}:{password}')
        digest_input = ':'.join([random_value, nc, cnonce, qop])
        method_digest = cp_hash(selected_authority, 'user.signin():/')
        hashed_password = cp_hash(selected_authority, f'{first}:{digest_input}:{method_digest}')
        return hashed_password, {
            'authorityType': selected_authority,
            'cnonce': cnonce,
            'nc': nc,
            'request-uri': '/',
            'qop': qop,
            'opaque': params.get('opaque', ''),
        }

    first = hashlib.md5(f'{username}:{realm}:{password}'.encode()).hexdigest()
    hashed_password = hashlib.md5(f'{username}:{random_value}:{first}'.encode()).hexdigest()
    return hashed_password, {
        'realm': realm,
        'random': random_value,
        'passwordType': 'Default',
        'authorityType': encryption,
    }


def login(base_url: str, username: str, password: str) -> tuple[requests.Session, int | str]:
    http = requests.Session()
    challenge = cpapi_post(
        http,
        base_url,
        {
            'method': 'user.signin',
            'params': {'userName': username, 'password': '', 'clientType': 'Web5.0'},
            'id': 1,
        },
        endpoint='/cpapi2_Login',
    )
    session_id = challenge.get('session')
    if not session_id:
        raise RuntimeError(f'Login challenge failed: {challenge}')

    hashed_password, extra_params = build_login_params(username, password, challenge)
    login_result = cpapi_post(
        http,
        base_url,
        {
            'method': 'user.signin',
            'params': {
                'userName': username,
                'password': hashed_password,
                'clientType': 'Web5.0',
                **extra_params,
            },
            'id': 2,
            'session': session_id,
        },
        endpoint='/cpapi2_Login',
    )
    if not login_result.get('result'):
        error = login_result.get('error', {})
        message = error.get('message') or 'Login rejected by camera'
        code = error.get('code')
        params = login_result.get('params') or {}
        lock_seconds = params.get('remainLockSecond')
        remain_times = params.get('remainLoginTimes')
        details = [message]
        if code is not None:
            details.append(f'code={code}')
        if lock_seconds is not None:
            details.append(f'remainLockSecond={lock_seconds}')
        if remain_times is not None:
            details.append(f'remainLoginTimes={remain_times}')
        details.append(f'raw={login_result}')
        error = '; '.join(details)
        raise RuntimeError(f'Login failed: {error}')
    return http, login_result.get('session', session_id)


def rpc(http: requests.Session, base_url: str, session_id: int | str, method: str, params=None, object_id=None, request_id: int = 10):
    body = {'method': method, 'params': params, 'id': request_id, 'session': session_id}
    if object_id is not None:
        body['object'] = object_id
    result = cpapi_post(http, base_url, body)
    if not result.get('result'):
        error = result.get('error', {}).get('message', result)
        raise RuntimeError(f'{method} failed: {error}')
    return result.get('params', result)


def rtsp_urls(ip: str, port: int, username: str, password: str, channel_no: int) -> list[str]:
    safe_user = quote(username, safe='')
    safe_password = quote(password, safe='')
    host = f'{ip}:{port}'
    credential_pairs = [(safe_user, safe_password)]
    if (safe_user, safe_password) != (username, password):
        credential_pairs.append((username, password))
    paths = [
        f'/video/live?channel={channel_no}&subtype=0&proto=Private3',
        f'/video/live?channel={channel_no}&subtype=1&proto=Private3',
        f'/cam/realmonitor?channel={channel_no}&subtype=0',
        f'/cam/realmonitor?channel={channel_no}&subtype=1',
        f'/Streaming/Channels/{channel_no}01',
        f'/streaming/channels/{channel_no}01',
        '/h264',
        '/ch0_0.h264',
    ]
    return [f'rtsp://{user}:{secret}@{host}{path}' for user, secret in credential_pairs for path in paths]


def open_rtsp_capture(url: str, timeout_ms: int = 5000):
    capture = cv2.VideoCapture()
    capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
    capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms)
    capture.open(url, cv2.CAP_FFMPEG)
    return capture


def placeholder_jpeg(text: str = 'Camera reconnecting'):
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    frame[:] = (10, 7, 4)
    cv2.putText(frame, text, (420, 350), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (210, 220, 235), 2, cv2.LINE_AA)
    ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    return encoded.tobytes() if ok else b''


def snapshot_urls(ip: str, port: int, channel_no: int) -> list[str]:
    base = camera_base_url(ip, port)
    return [
        f'{base}/cgi-bin/snapshot.cgi?channel={channel_no}',
        f'{base}/cgi-bin/snapshot.cgi?channel={channel_no - 1}',
        f'{base}/snapshot.jpg',
        f'{base}/ISAPI/Streaming/channels/{channel_no}01/picture',
    ]


def slmp_read_m_bit(host: str, port: int, device: str, address: int | str, timeout: float = 2.0) -> bool:
    device_codes = {
        'M': 0x90,
        'X': 0x9C,
        'Y': 0x9D,
        'L': 0x92,
        'F': 0x93,
        'B': 0xA0,
    }
    device_text = device.upper()
    device_code = device_codes.get(device_text)
    if device_code is None:
        raise ValueError(f'Unsupported SLMP device: {device}')
    address_text = str(address).strip().upper()
    if address_text.startswith(device_text):
        address_text = address_text[len(device_text):]
    address_number = int(address_text, 16) if device_text in {'X', 'Y'} else int(address_text, 10)

    payload = (
        (0x0010).to_bytes(2, 'little')
        + (0x0401).to_bytes(2, 'little')
        + (0x0001).to_bytes(2, 'little')
        + address_number.to_bytes(3, 'little')
        + bytes([device_code])
        + (1).to_bytes(2, 'little')
    )
    frame = (
        b'\x50\x00'
        + b'\x00'
        + b'\xff'
        + b'\xff\x03'
        + b'\x00'
        + len(payload).to_bytes(2, 'little')
        + payload
    )
    with socket.create_connection((host, int(port)), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(frame)
        response = sock.recv(1024)

    if len(response) < 11:
        raise RuntimeError(f'SLMP short response for {device}{address}: {response.hex(" ")}')
    end_code = int.from_bytes(response[9:11], 'little')
    if end_code != 0:
        raise RuntimeError(f'SLMP error for {device}{address}: 0x{end_code:04X}')
    data = response[11:]
    if not data:
        raise RuntimeError(f'SLMP no data for {device}{address}')
    return data[0] != 0x00


def read_plc_addresses(request: PlcMonitorRequest, addresses: list[int | str]) -> tuple[dict[str, bool], list[str]]:
    values = {}
    errors = []
    for address in addresses:
        address_text = str(address).strip().upper()
        key = address_text if address_text.startswith(request.plc_device.upper()) else f'{request.plc_device.upper()}{address_text}'
        try:
            values[key] = slmp_read_m_bit(request.plc_host, request.plc_port, request.plc_device, address)
        except Exception as exc:
            errors.append(str(exc))
    return values, errors


def tcp_reachable(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def reset_stale_recording_start(max_age_seconds: float = 20.0) -> bool:
    if not recording_state.get('running') or recording_state.get('path'):
        return False
    started_at = recording_state.get('started_at')
    if not started_at:
        return False
    try:
        age_seconds = (datetime.now() - datetime.fromisoformat(str(started_at))).total_seconds()
    except ValueError:
        return False
    if age_seconds < max_age_seconds:
        return False
    recording_stop_event.set()
    recording_state.update(
        {
            'running': False,
            'ended_at': datetime.now().isoformat(timespec='seconds'),
            'duration_seconds': round(age_seconds, 2),
            'error': 'Recording start timed out before stream opened.',
        }
    )
    return True


def current_recording_age_seconds() -> float | None:
    started_at = recording_state.get('started_at')
    if not started_at:
        return None
    try:
        return (datetime.now() - datetime.fromisoformat(str(started_at))).total_seconds()
    except ValueError:
        return None


def hide_secret(text: str, password: str) -> str:
    if not password:
        return text
    quoted_password = quote(password, safe='')
    return text.replace(password, '***').replace(quoted_password, '***')



def recording_folder(root_text: str) -> Path:
    root = Path(root_text).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_camera_folder(ip: str, channel: int) -> str:
    camera_part = ''.join(char if char.isalnum() else '-' for char in ip).strip('-')
    return f'{camera_part}_ch{channel:02d}'


def build_recording_paths(root_text: str, ip: str, channel: int, started_at: datetime) -> tuple[Path, Path, Path]:
    root = recording_folder(root_text)
    folder = root / started_at.strftime('%Y') / started_at.strftime('%m') / started_at.strftime('%d') / safe_camera_folder(ip, channel)
    folder.mkdir(parents=True, exist_ok=True)
    stem = f'cpplus_ch{channel:02d}_{started_at:%Y%m%d_%H%M%S}'
    temp_path = folder / f'{stem}_recording.mp4'
    final_path = folder / f'{stem}.mp4'
    return folder, temp_path, final_path


def metadata_path_for(video_path: Path) -> Path:
    return video_path.with_suffix('.json')


def atomic_write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile('w', encoding='utf-8', delete=False, dir=path.parent, suffix='.tmp') as tmp:
        json.dump(payload, tmp, indent=2)
        tmp.write('\n')
        temp_name = tmp.name
    Path(temp_name).replace(path)


def index_db_path(storage_root: str | Path) -> Path:
    root = recording_folder(str(storage_root))
    return root / 'recording_index.db'


def init_recording_index(storage_root: str | Path) -> Path:
    db_path = index_db_path(storage_root)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                metadata_path TEXT,
                storage_root TEXT NOT NULL,
                camera_ip TEXT,
                channel INTEGER,
                started_at TEXT,
                ended_at TEXT,
                duration_seconds REAL,
                frames INTEGER,
                file_size INTEGER,
                status TEXT,
                error TEXT,
                source_url TEXT,
                recording_engine TEXT,
                audio TEXT,
                event_type TEXT,
                event_started_at TEXT,
                event_ended_at TEXT,
                event_duration_seconds REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        existing_columns = {row[1] for row in connection.execute("PRAGMA table_info(recordings)").fetchall()}
        for column_name, column_type in {
            'event_type': 'TEXT',
            'event_started_at': 'TEXT',
            'event_ended_at': 'TEXT',
            'event_duration_seconds': 'REAL',
        }.items():
            if column_name not in existing_columns:
                connection.execute(f"ALTER TABLE recordings ADD COLUMN {column_name} {column_type}")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_started_at ON recordings(started_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_camera ON recordings(camera_ip, channel)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_event_type ON recordings(event_type)")
    return db_path


def load_sidecar_metadata(video_path: Path) -> dict:
    metadata_path = metadata_path_for(video_path)
    if not metadata_path.exists():
        return {}
    try:
        return json.loads(metadata_path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def index_recording_file(storage_root: str | Path, video_path: Path, metadata: dict | None = None) -> dict:
    video_path = Path(video_path)
    metadata = metadata or load_sidecar_metadata(video_path)
    file_stat = video_path.stat()
    now_text = datetime.now().isoformat(timespec='seconds')
    started_at = metadata.get('started_at') or datetime.fromtimestamp(file_stat.st_mtime).isoformat(timespec='seconds')
    record = {
        'file_path': str(video_path),
        'file_name': video_path.name,
        'metadata_path': str(metadata_path_for(video_path)) if metadata_path_for(video_path).exists() else None,
        'storage_root': str(storage_root),
        'camera_ip': metadata.get('camera_ip'),
        'channel': metadata.get('channel'),
        'started_at': started_at,
        'ended_at': metadata.get('ended_at'),
        'duration_seconds': metadata.get('duration_seconds'),
        'frames': metadata.get('frames'),
        'file_size': file_stat.st_size,
        'status': metadata.get('status') or 'completed',
        'error': metadata.get('error'),
        'source_url': metadata.get('source_url'),
        'recording_engine': metadata.get('recording_engine'),
        'audio': metadata.get('audio'),
        'event_type': metadata.get('event_type') or 'minor_stoppage',
        'event_started_at': metadata.get('event_started_at') or started_at,
        'event_ended_at': metadata.get('event_ended_at') or metadata.get('ended_at'),
        'event_duration_seconds': metadata.get('event_duration_seconds') or metadata.get('duration_seconds'),
        'created_at': now_text,
        'updated_at': now_text,
    }
    db_path = init_recording_index(storage_root)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO recordings (
                file_path, file_name, metadata_path, storage_root, camera_ip, channel,
                started_at, ended_at, duration_seconds, frames, file_size, status,
                error, source_url, recording_engine, audio, event_type, event_started_at,
                event_ended_at, event_duration_seconds, created_at, updated_at
            )
            VALUES (
                :file_path, :file_name, :metadata_path, :storage_root, :camera_ip, :channel,
                :started_at, :ended_at, :duration_seconds, :frames, :file_size, :status,
                :error, :source_url, :recording_engine, :audio, :event_type, :event_started_at,
                :event_ended_at, :event_duration_seconds, :created_at, :updated_at
            )
            ON CONFLICT(file_path) DO UPDATE SET
                file_name = excluded.file_name,
                metadata_path = excluded.metadata_path,
                storage_root = excluded.storage_root,
                camera_ip = excluded.camera_ip,
                channel = excluded.channel,
                started_at = excluded.started_at,
                ended_at = excluded.ended_at,
                duration_seconds = excluded.duration_seconds,
                frames = excluded.frames,
                file_size = excluded.file_size,
                status = excluded.status,
                error = excluded.error,
                source_url = excluded.source_url,
                recording_engine = excluded.recording_engine,
                audio = excluded.audio,
                event_type = excluded.event_type,
                event_started_at = excluded.event_started_at,
                event_ended_at = excluded.event_ended_at,
                event_duration_seconds = excluded.event_duration_seconds,
                updated_at = excluded.updated_at
            """,
            record,
        )
    return record


def scan_recording_index(request: RecordingIndexRequest) -> dict:
    root = recording_folder(request.storage_root)
    db_path = init_recording_index(root)
    indexed = 0
    for video_path in root.rglob('*'):
        if video_path.is_file() and video_path.suffix.lower() in {'.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv', '.dav'}:
            index_recording_file(root, video_path)
            indexed += 1
    pruned = prune_missing_recordings(root)
    result = list_recording_index(request)
    return {'db_path': str(db_path), 'indexed': indexed, 'pruned': pruned, **result}


def prune_missing_recordings(storage_root: str | Path) -> int:
    db_path = init_recording_index(storage_root)
    missing_paths = []
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute("SELECT file_path FROM recordings").fetchall()
        for row in rows:
            file_path = row[0]
            if file_path and not Path(file_path).exists():
                missing_paths.append(file_path)
        if missing_paths:
            connection.executemany("DELETE FROM recordings WHERE file_path = ?", [(path,) for path in missing_paths])
    return len(missing_paths)


def update_recording_event_metadata(
    storage_root: str,
    video_path_text: str | None,
    event_type: str,
    event_started_at: datetime | None,
    event_ended_at: datetime | None,
) -> None:
    if not video_path_text:
        return
    video_path = Path(video_path_text)
    if not video_path.exists():
        return
    metadata = load_sidecar_metadata(video_path)
    started_text = event_started_at.isoformat(timespec='seconds') if event_started_at else metadata.get('event_started_at') or metadata.get('started_at')
    ended_text = event_ended_at.isoformat(timespec='seconds') if event_ended_at else metadata.get('event_ended_at') or metadata.get('ended_at')
    duration = None
    if event_started_at and event_ended_at:
        duration = round((event_ended_at - event_started_at).total_seconds(), 2)
    metadata.update(
        {
            'event_type': event_type,
            'event_started_at': started_text,
            'event_ended_at': ended_text,
            'event_duration_seconds': duration or metadata.get('event_duration_seconds') or metadata.get('duration_seconds'),
        }
    )
    atomic_write_json(metadata_path_for(video_path), metadata)
    index_recording_file(storage_root, video_path, metadata)


def list_recording_index(request: RecordingIndexRequest) -> dict:
    db_path = init_recording_index(request.storage_root)
    prune_missing_recordings(request.storage_root)
    where = " WHERE 1=1"
    params: dict[str, str | int] = {}
    if request.start_at:
        where += " AND started_at >= :start_at"
        params['start_at'] = request.start_at
    if request.end_at:
        where += " AND started_at <= :end_at"
        params['end_at'] = request.end_at
    if request.event_type and request.event_type != 'all':
        if request.event_type == 'minor_stoppage':
            where += " AND (event_type = :event_type OR event_type IS NULL)"
        else:
            where += " AND event_type = :event_type"
        params['event_type'] = request.event_type
    if request.duration_filter == 'under_5':
        where += " AND COALESCE(event_duration_seconds, duration_seconds, 0) <= 300"
    elif request.duration_filter == 'over_5':
        where += " AND COALESCE(event_duration_seconds, duration_seconds, 0) > 300"
    if request.machine and request.machine != 'all':
        where += " AND camera_ip = :machine"
        params['machine'] = request.machine

    page_size = min(max(int(request.page_size or 50), 1), 100)
    page = max(int(request.page or 1), 1)
    offset = (page - 1) * page_size
    page_params = {**params, 'limit': page_size, 'offset': offset}

    query = f"SELECT * FROM recordings{where} ORDER BY started_at DESC, updated_at DESC LIMIT :limit OFFSET :offset"
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        total = int(connection.execute(f"SELECT COUNT(*) FROM recordings{where}", params).fetchone()[0])
        records = [dict(row) for row in connection.execute(query, page_params).fetchall()]
    return {'total': total, 'page': page, 'page_size': page_size, 'records': records}


def recording_stats(request: RecordingIndexRequest) -> dict:
    db_path = init_recording_index(request.storage_root)
    prune_missing_recordings(request.storage_root)
    today_text = datetime.now().date().isoformat()

    def scalar(connection: sqlite3.Connection, query: str, params: tuple = ()):
        value = connection.execute(query, params).fetchone()[0]
        return value or 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        today_total = scalar(connection, "SELECT COUNT(*) FROM recordings WHERE started_at >= ?", (today_text,))
        today_minor = scalar(connection, "SELECT COUNT(*) FROM recordings WHERE started_at >= ? AND (event_type = 'minor_stoppage' OR event_type IS NULL)", (today_text,))
        today_breakdown = scalar(connection, "SELECT COUNT(*) FROM recordings WHERE started_at >= ? AND event_type = 'breakdown'", (today_text,))
        today_recorded = scalar(connection, "SELECT SUM(COALESCE(duration_seconds, 0)) FROM recordings WHERE started_at >= ?", (today_text,))
        today_breakdown_duration = scalar(connection, "SELECT SUM(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings WHERE started_at >= ? AND event_type = 'breakdown'", (today_text,))
        today_storage = scalar(connection, "SELECT SUM(COALESCE(file_size, 0)) FROM recordings WHERE started_at >= ?", (today_text,))
        total_storage = scalar(connection, "SELECT SUM(COALESCE(file_size, 0)) FROM recordings")
        video_count = scalar(connection, "SELECT COUNT(*) FROM recordings")
        avg_file_size = scalar(connection, "SELECT AVG(COALESCE(file_size, 0)) FROM recordings")
        avg_breakdown = scalar(connection, "SELECT AVG(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings WHERE event_type = 'breakdown'")
        longest_breakdown = scalar(connection, "SELECT MAX(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings WHERE event_type = 'breakdown'")
        latest_row = connection.execute(
            "SELECT * FROM recordings ORDER BY started_at DESC, updated_at DESC LIMIT 1"
        ).fetchone()
        machines = [row[0] for row in connection.execute("SELECT DISTINCT camera_ip FROM recordings WHERE camera_ip IS NOT NULL ORDER BY camera_ip").fetchall()]
        trend_rows = connection.execute(
            """
            SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS video_count, SUM(COALESCE(file_size, 0)) AS storage_used
            FROM recordings
            GROUP BY day
            ORDER BY day DESC
            LIMIT 14
            """
        ).fetchall()
        top_rows = connection.execute(
            """
            SELECT file_name, file_path, file_size, started_at, event_type
            FROM recordings
            ORDER BY COALESCE(file_size, 0) DESC
            LIMIT 5
            """
        ).fetchall()

    week_storage = total_storage
    month_storage = total_storage
    return {
        'today': {
            'total_events': int(today_total),
            'minor_stoppage_count': int(today_minor),
            'breakdown_count': int(today_breakdown),
            'recorded_duration_seconds': float(today_recorded),
            'breakdown_duration_seconds': float(today_breakdown_duration),
            'storage_used': int(today_storage),
        },
        'storage': {
            'today': int(today_storage),
            'week': int(week_storage),
            'month': int(month_storage),
            'total': int(total_storage),
            'video_count': int(video_count),
            'average_file_size': float(avg_file_size),
        },
        'breakdown': {
            'average_duration_seconds': float(avg_breakdown),
            'longest_duration_seconds': float(longest_breakdown),
        },
        'latest_event': dict(latest_row) if latest_row else None,
        'trend': [dict(row) for row in trend_rows],
        'top_heavy_videos': [dict(row) for row in top_rows],
        'machines': machines,
    }


def mjpeg_frames(ip: str, rtsp_port: int, username: str, password: str, channel: int):
    capture = None
    last_placeholder_at = 0.0
    try:
        while True:
            if capture is None or not capture.isOpened():
                now = time.monotonic()
                if now - last_placeholder_at >= 2.0:
                    last_placeholder_at = now
                    placeholder = placeholder_jpeg()
                    if placeholder:
                        yield (
                            b'--frame\r\n'
                            b'Content-Type: image/jpeg\r\n\r\n'
                            + placeholder
                            + b'\r\n'
                        )
                for url in rtsp_urls(ip, rtsp_port, username, password, channel):
                    candidate = open_rtsp_capture(url, timeout_ms=1500)
                    if candidate.isOpened():
                        capture = candidate
                        break
                    candidate.release()
                if capture is None or not capture.isOpened():
                    time.sleep(1.0)
                    continue

            ok, frame = capture.read()
            if not ok or frame is None:
                capture.release()
                capture = None
                time.sleep(0.2)
                continue
            ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                continue
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n'
                + encoded.tobytes()
                + b'\r\n'
            )
    finally:
        if capture is not None:
            capture.release()


def record_camera_ffmpeg_worker(request: RecordingRequest) -> bool:
    global recording_process, recording_state
    ffmpeg_path = shutil.which('ffmpeg')
    if not ffmpeg_path:
        return False

    started_at = datetime.now()
    _, output_path, final_path = build_recording_paths(request.storage_root, request.ip, request.channel, started_at)
    candidate_urls = rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel)
    working_url = candidate_urls[0]
    recording_state.update(
        {
            'running': True,
            'path': str(output_path),
            'started_at': started_at.isoformat(timespec='seconds'),
            'ended_at': None,
            'duration_seconds': None,
            'error': None,
            'frames': 0,
            'url': hide_secret(working_url, request.password),
            'metadata_path': None,
            'audio': 'enabled',
            'recording_engine': 'ffmpeg',
            'event_type': request.event_type,
            'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
            'event_ended_at': None,
            'event_duration_seconds': None,
            'auto_stopped': False,
        }
    )

    command = [
        ffmpeg_path,
        '-y',
        '-rtsp_transport',
        'tcp',
        '-i',
        working_url,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        str(output_path),
    ]

    try:
        recording_process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        while not recording_stop_event.is_set() and recording_process.poll() is None:
            if (datetime.now() - started_at).total_seconds() >= max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1):
                recording_state['auto_stopped'] = True
                recording_stop_event.set()
                break
            time.sleep(0.25)
        if recording_stop_event.is_set() and recording_process.poll() is None:
            try:
                recording_process.communicate(input=b'q', timeout=5)
            except subprocess.TimeoutExpired:
                recording_process.terminate()
                try:
                    recording_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    recording_process.kill()
        stderr = b''
        if recording_process and recording_process.stderr:
            try:
                stderr = recording_process.stderr.read()[-1000:]
            except Exception:
                stderr = b''
        if recording_process and recording_process.returncode not in (0, None) and (not output_path.exists() or output_path.stat().st_size == 0):
            recording_state['error'] = stderr.decode(errors='ignore') or f'FFmpeg exited with {recording_process.returncode}'
    except Exception as exc:
        recording_state['error'] = str(exc)
    finally:
        ended_at = datetime.now()
        duration_seconds = max((ended_at - started_at).total_seconds(), 0)
        metadata = {
            'camera_ip': request.ip,
            'channel': request.channel,
            'started_at': started_at.isoformat(timespec='seconds'),
            'ended_at': ended_at.isoformat(timespec='seconds'),
            'duration_seconds': round(duration_seconds, 2),
            'status': 'failed' if recording_state.get('error') else 'completed',
            'error': recording_state.get('error'),
            'source_url': recording_state.get('url'),
            'recording_engine': 'ffmpeg',
            'audio': 'enabled',
            'auto_stopped': bool(recording_state.get('auto_stopped')),
            'event_type': recording_state.get('event_type') or request.event_type,
            'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
            'event_ended_at': recording_state.get('event_ended_at') or ended_at.isoformat(timespec='seconds'),
            'event_duration_seconds': recording_state.get('event_duration_seconds') or round(duration_seconds, 2),
        }
        if output_path.exists():
            end_suffix = ended_at.strftime('%H%M%S')
            target_path = final_path.with_name(f'{final_path.stem}_to_{end_suffix}{final_path.suffix}')
            if target_path.exists():
                target_path = final_path.with_name(f'{final_path.stem}_to_{end_suffix}_{int(time.time())}{final_path.suffix}')
            output_path.replace(target_path)
            metadata['file_name'] = target_path.name
            metadata['relative_path_hint'] = str(target_path)
            sidecar_path = metadata_path_for(target_path)
            atomic_write_json(sidecar_path, metadata)
            index_recording_file(request.storage_root, target_path, metadata)
            recording_state['path'] = str(target_path)
            recording_state['metadata_path'] = str(sidecar_path)
        recording_state['ended_at'] = ended_at.isoformat(timespec='seconds')
        recording_state['duration_seconds'] = round(duration_seconds, 2)
        recording_state['running'] = False
        recording_process = None
    return True


def record_camera_worker(request: RecordingRequest):
    global recording_state
    if record_camera_ffmpeg_worker(request):
        return
    capture = None
    writer = None
    output_path = None
    final_path = None
    started_at = datetime.now()
    fps = 15.0
    width = None
    height = None
    codec_used = None
    try:
        working_url = None
        first_frame = None
        for url in rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel):
            capture = cv2.VideoCapture()
            capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
            capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
            capture.open(url, cv2.CAP_FFMPEG)
            if not capture.isOpened():
                capture.release()
                capture = None
                continue
            ok, frame = capture.read()
            if ok and frame is not None:
                working_url = url
                first_frame = frame
                break
            capture.release()
            capture = None

        if capture is None or first_frame is None or working_url is None:
            raise RuntimeError('Camera RTSP stream open nahi hua.')

        height, width = first_frame.shape[:2]
        fps = capture.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or fps > 60:
            fps = 15.0

        _, output_path, final_path = build_recording_paths(request.storage_root, request.ip, request.channel, started_at)
        codec_used = None
        for codec_name in ('avc1', 'H264', 'X264', 'mp4v'):
            writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*codec_name), fps, (width, height))
            if writer.isOpened():
                codec_used = codec_name
                break
            writer.release()
            writer = None
        if writer is None or not writer.isOpened():
            raise RuntimeError(f'Video writer open nahi hua: {output_path}')

        recording_state.update(
            {
                'running': True,
                'path': str(output_path),
                'started_at': started_at.isoformat(timespec='seconds'),
                'ended_at': None,
                'duration_seconds': None,
                'error': None,
                'frames': 0,
                'url': hide_secret(working_url, request.password),
                'metadata_path': None,
                'audio': 'disabled; install ffmpeg for audio',
                'recording_engine': 'opencv',
                'event_type': request.event_type,
                'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
                'event_ended_at': None,
                'event_duration_seconds': None,
                'auto_stopped': False,
            }
        )

        writer.write(first_frame)
        recording_state['frames'] = 1

        while not recording_stop_event.is_set():
            if (datetime.now() - started_at).total_seconds() >= max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1):
                recording_state['auto_stopped'] = True
                recording_stop_event.set()
                break
            ok, frame = capture.read()
            if not ok or frame is None:
                time.sleep(0.1)
                continue
            writer.write(frame)
            recording_state['frames'] = int(recording_state.get('frames') or 0) + 1
    except Exception as exc:
        recording_state['error'] = str(exc)
    finally:
        if writer is not None:
            writer.release()
        if capture is not None:
            capture.release()
        ended_at = datetime.now()
        duration_seconds = max((ended_at - started_at).total_seconds(), 0)
        frames = int(recording_state.get('frames') or 0)
        metadata = {
            'camera_ip': request.ip,
            'channel': request.channel,
            'started_at': started_at.isoformat(timespec='seconds'),
            'ended_at': ended_at.isoformat(timespec='seconds'),
            'duration_seconds': round(duration_seconds, 2),
            'frames': frames,
            'fps': round(float(fps), 2),
            'width': width,
            'height': height,
            'codec': codec_used,
            'status': 'failed' if recording_state.get('error') else 'completed',
            'error': recording_state.get('error'),
            'source_url': recording_state.get('url'),
            'recording_engine': 'opencv',
            'audio': 'disabled; install ffmpeg for audio',
            'auto_stopped': bool(recording_state.get('auto_stopped')),
            'event_type': recording_state.get('event_type') or request.event_type,
            'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
            'event_ended_at': recording_state.get('event_ended_at') or ended_at.isoformat(timespec='seconds'),
            'event_duration_seconds': recording_state.get('event_duration_seconds') or round(duration_seconds, 2),
        }
        if output_path and output_path.exists():
            target_path = final_path or output_path
            if final_path:
                end_suffix = ended_at.strftime('%H%M%S')
                target_path = final_path.with_name(f'{final_path.stem}_to_{end_suffix}{final_path.suffix}')
                if target_path.exists():
                    target_path = final_path.with_name(f'{final_path.stem}_to_{end_suffix}_{int(time.time())}{final_path.suffix}')
                output_path.replace(target_path)
            metadata['file_name'] = target_path.name
            metadata['relative_path_hint'] = str(target_path)
            sidecar_path = metadata_path_for(target_path)
            atomic_write_json(sidecar_path, metadata)
            index_recording_file(request.storage_root, target_path, metadata)
            recording_state['path'] = str(target_path)
            recording_state['metadata_path'] = str(sidecar_path)
        recording_state['ended_at'] = ended_at.isoformat(timespec='seconds')
        recording_state['duration_seconds'] = round(duration_seconds, 2)
        recording_state['running'] = False


@app.post('/verify')
def verify(request: CameraRequest):
    try:
        login(camera_base_url(request.ip, request.http_port), request.username, request.password)
        return {'ok': True, 'method': 'http'}
    except Exception as exc:
        if tcp_reachable(request.ip, request.rtsp_port):
            return {'ok': True, 'method': 'rtsp', 'warning': str(exc)}
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/recordings')
def recordings(request: CameraRequest):
    if not request.start_at or not request.end_at:
        raise HTTPException(status_code=400, detail='start_at and end_at are required')
    try:
        base_url = camera_base_url(request.ip, request.http_port)
        http, session_id = login(base_url, request.username, request.password)
        instance = rpc(http, base_url, session_id, 'mediaFileFind.factory.create', None, request_id=3)
        object_id = instance.get('result') or instance.get('object') or instance
        condition = {
            'Channel': request.channel - 1,
            'StartTime': request.start_at,
            'EndTime': request.end_at,
            'Types': ['dav'],
        }

        records = []
        try:
            rpc(http, base_url, session_id, 'mediaFileFind.findFile', condition, object_id=object_id, request_id=4)
            while True:
                page = rpc(
                    http,
                    base_url,
                    session_id,
                    'mediaFileFind.findNextFile',
                    {'count': 100},
                    object_id=object_id,
                    request_id=5,
                )
                infos = page.get('infos') or []
                records.extend(infos)
                if page.get('found', len(infos)) < 100:
                    break
        finally:
            try:
                rpc(http, base_url, session_id, 'mediaFileFind.close', None, object_id=object_id, request_id=6)
                rpc(http, base_url, session_id, 'mediaFileFind.destroy', None, object_id=object_id, request_id=7)
            except Exception:
                pass
        records.sort(key=lambda item: item.get('StartTime', ''), reverse=True)
        return {'records': records}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/stream-urls')
def stream_urls(request: CameraRequest):
    try:
        base_url = camera_base_url(request.ip, request.http_port)
        http, session_id = login(base_url, request.username, request.password)
        result = rpc(
            http,
            base_url,
            session_id,
            'StreamUrlService.getUrls',
            {
                'protocol': 'RTMP',
                'type': 'live',
                'streamopt': {'channel': request.channel - 1, 'subtype': 0},
            },
            request_id=8,
        )
        return {'stream_urls': result}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/live-frame')
def live_frame(request: CameraRequest):
    errors = []
    http = requests.Session()
    for url in snapshot_urls(request.ip, request.http_port, request.channel):
        try:
            response = http.get(url, auth=(request.username, request.password), timeout=10)
            if response.ok and response.content:
                content_type = response.headers.get('content-type', '')
                if 'image' in content_type or response.content.startswith(b'\xff\xd8'):
                    return {
                        'url': hide_secret(url, request.password),
                        'frame': base64.b64encode(response.content).decode(),
                    }
            errors.append(f'snapshot failed {response.status_code}: {hide_secret(url, request.password)}')
        except requests.RequestException as exc:
            errors.append(f'snapshot error {hide_secret(str(exc), request.password)}')

    for url in rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel):
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        try:
            if not capture.isOpened():
                errors.append(f'open failed: {hide_secret(url, request.password)}')
                continue
            ok, frame = capture.read()
            if ok and frame is not None:
                ok, encoded = cv2.imencode('.jpg', frame)
                if ok:
                    return {'url': url, 'frame': base64.b64encode(encoded.tobytes()).decode()}
            errors.append(f'frame failed: {hide_secret(url, request.password)}')
        finally:
            capture.release()
    raise HTTPException(status_code=400, detail='; '.join(errors[-3:]))
@app.get('/mjpeg')
def mjpeg_stream(
    ip: str,
    rtsp_port: int = 554,
    username: str = 'admin',
    password: str = '',
    channel: int = 1,
):
    return StreamingResponse(
        mjpeg_frames(ip, rtsp_port, username, password, channel),
        media_type='multipart/x-mixed-replace; boundary=frame',
    )


@app.get('/recording/status')
def recording_status():
    return recording_state


@app.post('/recording/start')
def start_recording(request: RecordingRequest):
    global recording_thread
    if recording_state.get('running'):
        return recording_state

    recording_stop_event.clear()
    recording_state.update(
        {
            'running': True,
            'path': None,
            'started_at': datetime.now().isoformat(timespec='seconds'),
            'ended_at': None,
            'duration_seconds': None,
            'error': None,
            'frames': 0,
            'url': None,
            'metadata_path': None,
            'event_type': request.event_type,
            'event_started_at': datetime.now().isoformat(timespec='seconds'),
            'event_ended_at': None,
            'event_duration_seconds': None,
            'auto_stopped': False,
        }
    )
    recording_thread = threading.Thread(target=record_camera_worker, args=(request,), daemon=True)
    recording_thread.start()
    return recording_state


@app.post('/recording/stop')
def stop_recording():
    recording_stop_event.set()
    if recording_thread and recording_thread.is_alive():
        recording_thread.join(timeout=5)
    return recording_state


def plc_monitor_worker(request: PlcMonitorRequest):
    plc_monitor_state.update(
        {
            'running': True,
            'plc_host': request.plc_host,
            'plc_port': request.plc_port,
            'gate_open': False,
            'gate_close': False,
            'current_event_type': None,
            'current_event_started_at': None,
            'last_action': None,
            'last_read_at': None,
            'last_error': None,
            'open_values': {},
            'close_values': {},
        }
    )
    previous_open = None
    previous_close = False
    gate_cycle_maxed_out = True
    gate_event_started_at: datetime | None = None
    breakdown_marked = False
    last_start_attempt_at = 0.0
    poll_seconds = max(float(request.poll_seconds), 0.2)

    while not plc_monitor_stop_event.is_set():
        errors = []
        try:
            open_values, open_errors = read_plc_addresses(request, request.gate_open_addresses)
            close_values, close_errors = read_plc_addresses(request, request.gate_close_addresses)
            errors.extend(open_errors)
            errors.extend(close_errors)

            gate_open = any(value == bool(request.gate_open_when) for value in open_values.values())
            gate_close = any(value == bool(request.gate_close_when) for value in close_values.values())
            if gate_close:
                gate_cycle_maxed_out = False
                recording_state['auto_stopped'] = False
            current_event_type = None
            current_event_started_at = None
            if gate_open:
                current_event_type = 'breakdown' if recording_state.get('event_type') == 'breakdown' or breakdown_marked or gate_cycle_maxed_out else 'minor_stoppage'
                current_event_started_at = (
                    gate_event_started_at.isoformat(timespec='seconds')
                    if gate_event_started_at
                    else recording_state.get('event_started_at')
                )
            plc_monitor_state.update(
                {
                    'gate_open': gate_open,
                    'gate_close': gate_close,
                    'current_event_type': current_event_type,
                    'current_event_started_at': current_event_started_at,
                    'last_read_at': datetime.now().isoformat(timespec='seconds'),
                    'last_error': '; '.join(errors[-3:]) if errors else None,
                    'open_values': open_values,
                    'close_values': close_values,
                }
            )

            if previous_open is None and gate_cycle_maxed_out and not gate_close:
                plc_monitor_state['last_action'] = (
                    f'PLC monitor waiting for first gate close after startup at '
                    f'{datetime.now().isoformat(timespec="seconds")}.'
                )

            should_try_start = (
                gate_open
                and not gate_cycle_maxed_out
                and not recording_state.get('running')
                and not recording_state.get('auto_stopped')
            )
            start_retry_due = time.monotonic() - last_start_attempt_at >= 10.0
            if should_try_start and (not previous_open or start_retry_due):
                last_start_attempt_at = time.monotonic()
                if tcp_reachable(request.ip, request.rtsp_port):
                    if gate_event_started_at is None:
                        gate_event_started_at = datetime.now()
                        breakdown_marked = False
                    request.event_type = 'minor_stoppage'
                    start_recording(request)
                    recording_state['event_type'] = 'minor_stoppage'
                    recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                    plc_monitor_state['current_event_type'] = 'minor_stoppage'
                    plc_monitor_state['current_event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                    plc_monitor_state['last_action'] = f'Auto recording started on {request.plc_device.upper()} signal OFF at {datetime.now().isoformat(timespec="seconds")}'
                else:
                    plc_monitor_state['last_error'] = f'Camera RTSP not reachable: {request.ip}:{request.rtsp_port}'

            if gate_open and not recording_state.get('running') and recording_state.get('auto_stopped'):
                gate_cycle_maxed_out = True

            if gate_close and not previous_close:
                closed_at = datetime.now()
                if recording_state.get('running'):
                    recording_state['event_type'] = 'minor_stoppage'
                    recording_state['event_ended_at'] = closed_at.isoformat(timespec='seconds')
                    if gate_event_started_at:
                        recording_state['event_duration_seconds'] = round((closed_at - gate_event_started_at).total_seconds(), 2)
                    stop_recording()
                    plc_monitor_state['last_action'] = f'Minor stoppage saved on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
                elif breakdown_marked:
                    update_recording_event_metadata(
                        request.storage_root,
                        recording_state.get('path'),
                        'breakdown',
                        gate_event_started_at,
                        closed_at,
                    )
                    recording_state['event_type'] = 'breakdown'
                    recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds') if gate_event_started_at else None
                    recording_state['event_ended_at'] = closed_at.isoformat(timespec='seconds')
                    recording_state['event_duration_seconds'] = (
                        round((closed_at - gate_event_started_at).total_seconds(), 2) if gate_event_started_at else None
                    )
                    plc_monitor_state['last_action'] = f'Breakdown closed on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
                gate_event_started_at = None
                breakdown_marked = False
                plc_monitor_state['current_event_type'] = None
                plc_monitor_state['current_event_started_at'] = None

            recording_age = current_recording_age_seconds()
            max_record_seconds = max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1)
            if gate_open and recording_state.get('running') and recording_age is not None and recording_age >= max_record_seconds:
                recording_state['event_type'] = 'breakdown'
                if gate_event_started_at:
                    recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                stop_recording()
                gate_cycle_maxed_out = True
                breakdown_marked = True
                plc_monitor_state['current_event_type'] = 'breakdown'
                plc_monitor_state['current_event_started_at'] = (
                    gate_event_started_at.isoformat(timespec='seconds')
                    if gate_event_started_at
                    else recording_state.get('event_started_at')
                )
                plc_monitor_state['last_action'] = (
                    f'Auto recording stopped after max gate-open duration {max_record_seconds}s at '
                    f'{datetime.now().isoformat(timespec="seconds")}. Breakdown timer continues until gate close.'
                )

            if reset_stale_recording_start():
                plc_monitor_state['last_error'] = recording_state.get('error')

            previous_open = gate_open
            previous_close = gate_close
        except Exception as exc:
            plc_monitor_state.update(
                {
                    'last_read_at': datetime.now().isoformat(timespec='seconds'),
                    'last_error': str(exc),
                }
            )
        time.sleep(poll_seconds)

    plc_monitor_state['running'] = False


@app.get('/plc-monitor/status')
def plc_monitor_status():
    ensure_auto_plc_monitor_running()
    return plc_monitor_state


@app.post('/plc-monitor/start')
def start_plc_monitor(request: PlcMonitorRequest):
    global plc_monitor_thread
    if plc_monitor_state.get('running') and plc_monitor_thread and plc_monitor_thread.is_alive():
        return plc_monitor_state

    plc_monitor_stop_event.clear()
    plc_monitor_thread = threading.Thread(target=plc_monitor_worker, args=(request,), daemon=True)
    plc_monitor_thread.start()
    return plc_monitor_state


@app.post('/plc-monitor/stop')
def stop_plc_monitor():
    plc_monitor_stop_event.set()
    if plc_monitor_thread and plc_monitor_thread.is_alive():
        plc_monitor_thread.join(timeout=3)
    plc_monitor_state['running'] = False
    return plc_monitor_state


def default_plc_monitor_request() -> PlcMonitorRequest:
    return PlcMonitorRequest(
        ip=DEFAULT_CAMERA_IP,
        http_port=80,
        rtsp_port=554,
        username=DEFAULT_CAMERA_USER,
        password=DEFAULT_CAMERA_PASSWORD,
        channel=1,
        storage_root=DEFAULT_STORAGE_ROOT,
        plc_host='192.168.117.201',
        plc_port=1026,
        plc_device='X',
        gate_open_addresses=['4A'],
        gate_close_addresses=['4A'],
        gate_open_when=False,
        gate_close_when=True,
        poll_seconds=0.5,
        max_record_seconds=MAX_GATE_RECORD_SECONDS,
    )


def ensure_auto_plc_monitor_running():
    if plc_monitor_state.get('running') and plc_monitor_thread and plc_monitor_thread.is_alive():
        return
    try:
        start_plc_monitor(default_plc_monitor_request())
    except Exception as exc:
        plc_monitor_state['last_error'] = f'PLC monitor auto-start failed: {exc}'


@app.on_event('startup')
def auto_start_plc_monitor():
    ensure_auto_plc_monitor_running()


@app.post('/recording-index/scan')
def recording_index_scan(request: RecordingIndexRequest):
    try:
        return scan_recording_index(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/recording-index/list')
def recording_index_list(request: RecordingIndexRequest):
    try:
        return {'db_path': str(index_db_path(request.storage_root)), **list_recording_index(request)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/recording-index/stats')
def recording_index_stats(request: RecordingIndexRequest):
    try:
        return {'db_path': str(index_db_path(request.storage_root)), **recording_stats(request)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get('/recording-file')
def recording_file(storage_root: str, file_path: str, download: bool = False):
    root = recording_folder(storage_root).resolve()
    requested = Path(file_path).resolve()
    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail='Recording not found')
    if root != requested and root not in requested.parents:
        raise HTTPException(status_code=403, detail='Recording path outside storage root')
    if requested.suffix.lower() not in VIDEO_FILE_EXTENSIONS:
        raise HTTPException(status_code=400, detail='Unsupported recording file')

    media_type = mimetypes.guess_type(requested.name)[0] or 'application/octet-stream'
    disposition = 'attachment' if download else 'inline'
    return FileResponse(
        requested,
        media_type=media_type,
        filename=requested.name,
        content_disposition_type=disposition,
    )


@app.post('/download')
def download(request: DownloadRequest):
    try:
        base_url = camera_base_url(request.ip, request.http_port)
        http, _ = login(base_url, request.username, request.password)
        response = http.get(f'{base_url}/cpapi_Loadfile{request.file_path}', timeout=120)
        response.raise_for_status()
        return {'content': base64.b64encode(response.content).decode()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8010, reload=False)
