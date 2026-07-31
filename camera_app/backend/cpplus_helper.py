import base64
import csv
import hashlib
import io
import json
import mimetypes
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time
import zipfile
import asyncio
import ssl
from datetime import datetime, time as datetime_time
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

import cv2
import numpy as np
import requests
import uvicorn
import urllib3
import websockets
from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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
DEFAULT_STORAGE_ROOT = '/home/automation/apps/Camera-WebApp/camera_app/recordings'
LEGACY_STORAGE_ROOT = r'D:\CPPLUS_RECORDINGS'
APP_BASE_DIR = Path(__file__).resolve().parents[1]
FALLBACK_STORAGE_ROOT = APP_BASE_DIR / 'recordings'
HELPER_SETTINGS_PATH = Path(os.getenv('HELPER_SETTINGS_PATH', APP_BASE_DIR / 'helper_settings.json'))
MAX_GATE_RECORD_SECONDS = 300
RECORDING_MAX_WIDTH = 1280
RECORDING_TARGET_FPS = 15.0
RECORDING_CRF = 28
RECORDING_AUDIO_FILTER = 'highpass=f=120,lowpass=f=3500,afftdn=nf=-25,dynaudnorm=f=150:g=15,volume=2.5,alimiter=limit=0.95'
LIVE_PREVIEW_MAX_WIDTH = 1280
LIVE_PREVIEW_TARGET_FPS = 8.0
LIVE_PREVIEW_STALE_SECONDS = 8.0
USE_FFMPEG_RECORDING = True
RECORDING_START_RETRY_SECONDS = 1.0
RECORDING_START_STALE_SECONDS = 4.0
RTSP_RECORD_OPEN_TIMEOUT_MS = 5000
GATE_CLOSE_START_COOLDOWN_SECONDS = 2.0
PLC_FAILOVER_PORTS = [5003]
KNOWN_FFMPEG_PATHS = [
    Path.home() / 'AppData' / 'Local' / 'Microsoft' / 'WinGet' / 'Packages' / 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe' / 'ffmpeg-8.1.2-full_build' / 'bin' / 'ffmpeg.exe',
]


def ffmpeg_executable() -> str | None:
    configured_path = os.getenv('FFMPEG_PATH')
    if configured_path and Path(configured_path).exists():
        return configured_path
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return ffmpeg_path
    for path in KNOWN_FFMPEG_PATHS:
        if path.exists():
            return str(path)
    return None


class CameraRequest(BaseModel):
    ip: str
    http_port: int = 80
    rtsp_port: int = 554
    username: str
    password: str
    channel: int = 1
    rtsp_path: str | None = None
    start_at: str | None = None
    end_at: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class DownloadRequest(CameraRequest):
    file_path: str


class RecordingRequest(CameraRequest):
    storage_root: str = DEFAULT_STORAGE_ROOT
    max_record_seconds: int = MAX_GATE_RECORD_SECONDS
    event_type: str = 'minor_stoppage'
    capture_video: bool = True
    capture_breakdown_video: bool = True


class PlcMonitorRequest(RecordingRequest):
    plc_host: str = '192.168.117.201'
    plc_port: int = 5003
    plc_device: str = 'X'
    gate_open_addresses: list[int | str] = ['4A']
    gate_close_addresses: list[int | str] = ['4A']
    gate_open_when: bool = False
    gate_close_when: bool = True
    poll_seconds: float = 1.0
    max_record_seconds: int = MAX_GATE_RECORD_SECONDS


class HelperSettings(BaseModel):
    ip: str = DEFAULT_CAMERA_IP
    http_port: int = 80
    rtsp_port: int = 554
    username: str = DEFAULT_CAMERA_USER
    password: str = DEFAULT_CAMERA_PASSWORD
    channel: int = 1
    rtsp_path: str | None = None
    storage_root: str = DEFAULT_STORAGE_ROOT
    public_helper_url: str | None = None
    capture_video: bool = True
    capture_breakdown_video: bool = True
    plc_enabled: bool = True
    plc_host: str = '192.168.117.201'
    plc_port: int = 5003
    plc_device: str = 'X'
    plc_address: str = '4A'
    max_record_seconds: int = MAX_GATE_RECORD_SECONDS


class RecordingIndexRequest(BaseModel):
    storage_root: str = DEFAULT_STORAGE_ROOT
    start_at: str | None = None
    end_at: str | None = None
    event_type: str | None = None
    shift: str | None = None
    duration_filter: str | None = None
    machine: str | None = None
    public_helper_url: str | None = None
    page: int = 1
    page_size: int = 50


class ReasonRequest(BaseModel):
    storage_root: str = DEFAULT_STORAGE_ROOT
    category: str
    reason: str


class RecordingReasonRequest(BaseModel):
    storage_root: str = DEFAULT_STORAGE_ROOT
    file_path: str | None = None
    event_started_at: str | None = None
    event_type: str
    reason: str
    note: str | None = None
    submitted_by: str | None = 'Admin'


DEFAULT_REASON_OPTIONS = {
    'minor_stoppage': [
        'Material loading delay',
        'Operator checking machine',
        'Quality inspection',
        'Mould cleaning',
        'Minor adjustment',
        'Safety door opened',
    ],
    'breakdown': [
        'Mechanical breakdown',
        'Electrical fault',
        'Hydraulic issue',
        'Machine alarm',
        'Utility issue',
        'Maintenance intervention',
    ],
}


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
    'enabled': True,
    'capture_video': True,
    'capture_breakdown_video': True,
    'running': False,
    'plc_host': None,
    'plc_port': None,
    'plc_device': None,
    'gate_open_addresses': [],
    'gate_close_addresses': [],
    'gate_open_when': None,
    'gate_close_when': None,
    'max_record_seconds': MAX_GATE_RECORD_SECONDS,
    'gate_open': False,
    'gate_close': False,
    'machine_state': None,
    'machine_state_started_at': None,
    'machine_state_duration_seconds': 0,
    'current_event_type': None,
    'current_event_started_at': None,
    'current_event_duration_seconds': None,
    'last_gate_opened_at': None,
    'last_gate_closed_at': None,
    'last_action': None,
    'last_read_at': None,
    'last_error': None,
    'open_values': {},
    'close_values': {},
}
plc_monitor_stop_event = threading.Event()
plc_monitor_thread: threading.Thread | None = None
shared_camera_lock = threading.Lock()
shared_camera_stop_event = threading.Event()
shared_camera_thread: threading.Thread | None = None
shared_camera_state = {
    'key': None,
    'worker_id': 0,
    'running': False,
    'url': None,
    'raw_url': None,
    'frame': None,
    'frame_at': None,
    'width': None,
    'height': None,
    'fps': RECORDING_TARGET_FPS,
    'last_error': None,
}


def camera_base_url(ip: str, port: int) -> str:
    if int(port) == 443:
        return f'https://{ip}:443'
    port_text = '' if port == 80 else f':{port}'
    return f'http://{ip}{port_text}'


def camera_base_url_candidates(ip: str, port: int) -> list[str]:
    primary = camera_base_url(ip, port)
    candidates = [primary]
    if int(port) == 80:
        candidates.append(f'https://{ip}:443')
    elif int(port) == 443:
        candidates.append(f'http://{ip}')
    return candidates


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
        verify=False,
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


def login_camera(ip: str, port: int, username: str, password: str) -> tuple[requests.Session, int | str, str]:
    errors: list[str] = []
    for base_url in camera_base_url_candidates(ip, port):
        try:
            http, session_id = login(base_url, username, password)
            return http, session_id, base_url
        except Exception as exc:
            errors.append(f'{base_url}: {exc}')
    raise RuntimeError('; '.join(errors))


def rpc(http: requests.Session, base_url: str, session_id: int | str, method: str, params=None, object_id=None, request_id: int = 10):
    body = {'method': method, 'params': params, 'id': request_id, 'session': session_id}
    if object_id is not None:
        body['object'] = object_id
    result = cpapi_post(http, base_url, body)
    if not result.get('result'):
        error = result.get('error', {}).get('message', result)
        raise RuntimeError(f'{method} failed: {error}')
    return result.get('params', result)


def normalize_rtsp_path(path: str | None, channel_no: int) -> str | None:
    if not path:
        return None
    normalized = path.strip()
    if not normalized:
        return None
    normalized = normalized.replace('<IP Address>', '{ip}')
    normalized = normalized.replace('<Username>', '{username}')
    normalized = normalized.replace('<Password>', '{password}')
    normalized = normalized.replace('{channel}', str(channel_no))
    normalized = normalized.replace('<channel>', str(channel_no))
    return normalized


def rtsp_urls(ip: str, port: int, username: str, password: str, channel_no: int, rtsp_path: str | None = None) -> list[str]:
    safe_user = quote(username, safe='')
    safe_password = quote(password, safe='')
    host = f'{ip}:{port}'
    credential_pairs = [(safe_user, safe_password)]
    if (safe_user, safe_password) != (username, password):
        credential_pairs.append((username, password))
    custom_path = normalize_rtsp_path(rtsp_path, channel_no)
    paths = [
        f'/video/live?channel={channel_no}&subtype=0',
        f'/video/live?channel={channel_no}&subtype=1',
        f'/video/live?channel={channel_no}&subtype=0&proto=Private3',
        f'/video/live?channel={channel_no}&subtype=1&proto=Private3',
        f'/live/realmonitor.xav?channel={channel_no}&subtype=0',
        f'/live/realmonitor.xav?channel={channel_no}&subtype=1',
        f'/cam/realmonitor?channel={channel_no}&subtype=0',
        f'/cam/realmonitor?channel={channel_no}&subtype=1',
        f'/Streaming/Channels/{channel_no}01',
        f'/streaming/channels/{channel_no}01',
        '/h264',
        '/ch0_0.h264',
    ]
    if custom_path:
        if custom_path.startswith('rtsp://') or custom_path.startswith('rtsps://'):
            return [
                custom_path.format(
                    username=safe_user,
                    password=safe_password,
                    ip=ip,
                    port=port,
                    channel=channel_no,
                )
            ]
        if not custom_path.startswith('/'):
            custom_path = f'/{custom_path}'
        paths = [custom_path, *[path for path in paths if path != custom_path]]
    schemes = ['rtsps', 'rtsp'] if int(port) == 443 else ['rtsp']
    return [f'{scheme}://{user}:{secret}@{host}{path}' for scheme in schemes for user, secret in credential_pairs for path in paths]


def open_rtsp_capture(url: str, timeout_ms: int = 5000):
    capture = cv2.VideoCapture()
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
    capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, min(timeout_ms, 2000))
    capture.open(url, cv2.CAP_FFMPEG)
    return capture


def prepare_live_preview_frame(frame):
    if frame is None:
        return None
    height, width = frame.shape[:2]
    if width <= LIVE_PREVIEW_MAX_WIDTH:
        return frame
    output_height = max(int(height * (LIVE_PREVIEW_MAX_WIDTH / width)), 1)
    return cv2.resize(frame, (LIVE_PREVIEW_MAX_WIDTH, output_height), interpolation=cv2.INTER_AREA)


def placeholder_jpeg(text: str = 'Camera reconnecting'):
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    frame[:] = (10, 7, 4)
    cv2.putText(frame, text, (420, 350), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (210, 220, 235), 2, cv2.LINE_AA)
    ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    return encoded.tobytes() if ok else b''


def shared_camera_key(ip: str, rtsp_port: int, username: str, password: str, channel: int, rtsp_path: str | None = None) -> tuple:
    return (ip, int(rtsp_port), username, password, int(channel), normalize_rtsp_path(rtsp_path, channel))


def shared_camera_worker(
    worker_id: int,
    ip: str,
    rtsp_port: int,
    username: str,
    password: str,
    channel: int,
    rtsp_path: str | None = None,
):
    key = shared_camera_key(ip, rtsp_port, username, password, channel, rtsp_path)
    capture = None

    def is_current_worker() -> bool:
        with shared_camera_lock:
            return shared_camera_state.get('worker_id') == worker_id

    try:
        with shared_camera_lock:
            if shared_camera_state.get('worker_id') != worker_id:
                return
            shared_camera_state.update({'key': key, 'running': True, 'last_error': None})
        while not shared_camera_stop_event.is_set():
            if not is_current_worker():
                break
            if capture is None or not capture.isOpened():
                if not tcp_reachable(ip, rtsp_port, timeout=1.5):
                    with shared_camera_lock:
                        if shared_camera_state.get('worker_id') == worker_id:
                            shared_camera_state['last_error'] = (
                                f'Camera RTSP port {ip}:{rtsp_port} is not reachable from the helper PC. '
                                'Check camera IP, VLAN/subnet route, firewall, and RTSP service.'
                            )
                    time.sleep(2.0)
                    continue
                tried_urls = []
                for url in rtsp_urls(ip, rtsp_port, username, password, channel, rtsp_path):
                    if not is_current_worker():
                        break
                    tried_urls.append(hide_secret(url, password))
                    candidate = open_rtsp_capture(url, timeout_ms=5000)
                    if candidate.isOpened():
                        capture = candidate
                        fps = capture.get(cv2.CAP_PROP_FPS)
                        if fps <= 0 or fps > 60:
                            fps = RECORDING_TARGET_FPS
                        with shared_camera_lock:
                            if shared_camera_state.get('worker_id') == worker_id:
                                shared_camera_state.update(
                                    {
                                        'url': hide_secret(url, password),
                                        'raw_url': url,
                                        'fps': min(float(fps), RECORDING_TARGET_FPS),
                                        'last_error': None,
                                    }
                                )
                        break
                    candidate.release()
                if capture is None or not capture.isOpened():
                    with shared_camera_lock:
                        if shared_camera_state.get('worker_id') == worker_id:
                            shared_camera_state['last_error'] = (
                                'RTSP port is reachable but no video frame opened. '
                                'Check username/password, channel, RTSP path, and camera RTSP settings. '
                                f'Tried: {", ".join(tried_urls[:4])}'
                            )
                    time.sleep(0.25)
                    continue

            ok, frame = capture.read()
            if not ok or frame is None:
                capture.release()
                capture = None
                with shared_camera_lock:
                    if shared_camera_state.get('worker_id') == worker_id:
                        shared_camera_state['last_error'] = 'Camera frame read failed.'
                time.sleep(0.1)
                continue

            height, width = frame.shape[:2]
            with shared_camera_lock:
                if shared_camera_state.get('worker_id') == worker_id:
                    shared_camera_state.update(
                        {
                            'frame': frame.copy(),
                            'frame_at': time.monotonic(),
                            'width': width,
                            'height': height,
                            'last_error': None,
                        }
                    )
    finally:
        if capture is not None:
            capture.release()
        with shared_camera_lock:
            if shared_camera_state.get('worker_id') == worker_id:
                shared_camera_state['running'] = False


def ensure_shared_camera_worker(ip: str, rtsp_port: int, username: str, password: str, channel: int, rtsp_path: str | None = None):
    global shared_camera_thread
    key = shared_camera_key(ip, rtsp_port, username, password, channel, rtsp_path)
    with shared_camera_lock:
        current_key = shared_camera_state.get('key')
        running = bool(shared_camera_state.get('running'))
    if running and current_key == key and shared_camera_thread and shared_camera_thread.is_alive():
        return
    if running and shared_camera_thread and shared_camera_thread.is_alive():
        shared_camera_stop_event.set()
        shared_camera_thread.join(timeout=3)
    shared_camera_stop_event.clear()
    with shared_camera_lock:
        worker_id = int(shared_camera_state.get('worker_id') or 0) + 1
        shared_camera_state.update(
            {
                'key': key,
                'worker_id': worker_id,
                'running': False,
                'url': None,
                'raw_url': None,
                'frame': None,
                'frame_at': None,
                'width': None,
                'height': None,
                'fps': RECORDING_TARGET_FPS,
                'last_error': 'Camera stream starting.',
            }
        )
    shared_camera_thread = threading.Thread(
        target=shared_camera_worker,
        args=(worker_id, ip, rtsp_port, username, password, channel, rtsp_path),
        daemon=True,
    )
    shared_camera_thread.start()


def latest_shared_frame(max_age_seconds: float = 2.0):
    with shared_camera_lock:
        frame = shared_camera_state.get('frame')
        frame_at = shared_camera_state.get('frame_at')
        url = shared_camera_state.get('url')
        fps = shared_camera_state.get('fps') or RECORDING_TARGET_FPS
    if frame is None or frame_at is None:
        return None, None, fps
    if time.monotonic() - float(frame_at) > max_age_seconds:
        return None, url, fps
    return frame.copy(), url, fps


def latest_shared_rtsp_url(max_age_seconds: float = 10.0) -> str | None:
    with shared_camera_lock:
        raw_url = shared_camera_state.get('raw_url')
        frame_at = shared_camera_state.get('frame_at')
    if not raw_url or not frame_at:
        return None
    if time.monotonic() - float(frame_at) > max_age_seconds:
        return None
    return raw_url


def snapshot_urls(ip: str, port: int, channel_no: int) -> list[str]:
    urls: list[str] = []
    for base in camera_base_url_candidates(ip, port):
        urls.extend([
            f'{base}/cgi-bin/snapshot.cgi?channel={channel_no}',
            f'{base}/cgi-bin/snapshot.cgi?channel={channel_no - 1}',
            f'{base}/snapshot.jpg',
            f'{base}/ISAPI/Streaming/channels/{channel_no}01/picture',
        ])
    return urls


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


def plc_candidate_ports(primary_port: int | str | None) -> list[int]:
    ports = []
    try:
        ports.append(int(primary_port or PLC_FAILOVER_PORTS[0]))
    except (TypeError, ValueError):
        pass
    for port in PLC_FAILOVER_PORTS:
        if int(port) not in ports:
            ports.append(int(port))
    return ports


def read_plc_addresses(request: PlcMonitorRequest, addresses: list[int | str], port: int | None = None) -> tuple[dict[str, bool], list[str]]:
    values = {}
    errors = []
    read_port = int(port if port is not None else request.plc_port)
    for address in addresses:
        address_text = str(address).strip().upper()
        key = address_text if address_text.startswith(request.plc_device.upper()) else f'{request.plc_device.upper()}{address_text}'
        try:
            values[key] = slmp_read_m_bit(request.plc_host, read_port, request.plc_device, address)
        except Exception as exc:
            errors.append(f'{request.plc_host}:{read_port} {exc}')
    return values, errors


def read_plc_failover(request: PlcMonitorRequest) -> tuple[dict[str, bool], dict[str, bool], list[str], int | None]:
    all_errors = []
    open_addresses = [str(address).strip().upper() for address in request.gate_open_addresses]
    close_addresses = [str(address).strip().upper() for address in request.gate_close_addresses]
    same_addresses = open_addresses == close_addresses
    for port in plc_candidate_ports(request.plc_port):
        open_values, open_errors = read_plc_addresses(request, request.gate_open_addresses, port)
        if same_addresses:
            close_values, close_errors = dict(open_values), list(open_errors)
        else:
            close_values, close_errors = read_plc_addresses(request, request.gate_close_addresses, port)
        errors = [*open_errors, *close_errors]
        if (open_values or close_values) and not errors:
            return open_values, close_values, [], port
        if open_values or close_values:
            return open_values, close_values, errors, port
        all_errors.extend(errors)
    return {}, {}, all_errors[-6:], None


def tcp_reachable(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def reset_stale_recording_start(max_age_seconds: float = RECORDING_START_STALE_SECONDS) -> bool:
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


def seconds_since_iso(value: object) -> float | None:
    if not value:
        return None
    try:
        return max((datetime.now() - datetime.fromisoformat(str(value))).total_seconds(), 0)
    except ValueError:
        return None


def hide_secret(text: str, password: str) -> str:
    if not password:
        return text
    quoted_password = quote(password, safe='')
    return text.replace(password, '***').replace(quoted_password, '***')



def normalize_storage_root(root_text: str | Path | None) -> str:
    text = str(root_text or DEFAULT_STORAGE_ROOT).strip() or DEFAULT_STORAGE_ROOT
    normalized = text.rstrip('\\/').lower()
    if normalized == LEGACY_STORAGE_ROOT.lower():
        return DEFAULT_STORAGE_ROOT
    return text


def recording_folder(root_text: str | Path) -> Path:
    root = Path(normalize_storage_root(root_text)).expanduser()
    try:
        root.mkdir(parents=True, exist_ok=True)
        test_path = root / '.write_test'
        test_path.write_text('ok', encoding='utf-8')
        test_path.unlink(missing_ok=True)
    except OSError:
        root = FALLBACK_STORAGE_ROOT
        root.mkdir(parents=True, exist_ok=True)
    return root


def normalized_helper_settings(settings: HelperSettings) -> HelperSettings:
    data = settings.model_dump()
    data['ip'] = str(data.get('ip') or DEFAULT_CAMERA_IP).strip() or DEFAULT_CAMERA_IP
    data['username'] = str(data.get('username') or DEFAULT_CAMERA_USER)
    data['password'] = str(data.get('password') or DEFAULT_CAMERA_PASSWORD)
    data['rtsp_path'] = normalize_rtsp_path(data.get('rtsp_path'), max(int(data.get('channel') or 1), 1))
    data['plc_device'] = str(data.get('plc_device') or 'X').strip().upper() or 'X'
    data['plc_address'] = str(data.get('plc_address') or '4A').strip().upper() or '4A'
    data['storage_root'] = normalize_storage_root(data.get('storage_root') or DEFAULT_STORAGE_ROOT)
    data['plc_enabled'] = bool(data.get('plc_enabled', True))
    data['http_port'] = max(int(data.get('http_port') or 80), 1)
    data['rtsp_port'] = max(int(data.get('rtsp_port') or 554), 1)
    data['channel'] = max(int(data.get('channel') or 1), 1)
    data['plc_port'] = max(int(data.get('plc_port') or 5003), 1)
    data['max_record_seconds'] = max(int(data.get('max_record_seconds') or MAX_GATE_RECORD_SECONDS), 1)
    return HelperSettings(**data)


def load_helper_settings() -> HelperSettings:
    try:
        if HELPER_SETTINGS_PATH.exists():
            return normalized_helper_settings(HelperSettings(**json.loads(HELPER_SETTINGS_PATH.read_text(encoding='utf-8'))))
    except Exception as exc:
        plc_monitor_state['last_error'] = f'Settings load failed: {exc}'
    return normalized_helper_settings(HelperSettings())


def save_helper_settings(settings: HelperSettings) -> HelperSettings:
    normalized = normalized_helper_settings(settings)
    HELPER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(HELPER_SETTINGS_PATH, normalized.model_dump())
    return normalized


def settings_to_plc_request(settings: HelperSettings) -> PlcMonitorRequest:
    return PlcMonitorRequest(
        ip=settings.ip,
        http_port=settings.http_port,
        rtsp_port=settings.rtsp_port,
        username=settings.username,
        password=settings.password,
        channel=settings.channel,
        rtsp_path=settings.rtsp_path,
        storage_root=settings.storage_root,
        capture_video=settings.capture_video,
        capture_breakdown_video=settings.capture_breakdown_video,
        plc_host=settings.plc_host,
        plc_port=settings.plc_port,
        plc_device=settings.plc_device,
        gate_open_addresses=[settings.plc_address],
        gate_close_addresses=[settings.plc_address],
        gate_open_when=False,
        gate_close_when=True,
        poll_seconds=1.0,
        max_record_seconds=settings.max_record_seconds,
    )


def auth_session(username: str, password: str) -> dict:
    normalized_username = username.strip().lower()
    if normalized_username == 'superadmin' and password == 'Super@123':
        return {'username': 'superadmin', 'role': 'superadmin', 'token': 'superadmin-token'}
    if normalized_username == 'admin' and password == 'Admin@123':
        return {'username': 'admin', 'role': 'admin', 'token': 'admin-token'}
    if normalized_username in {'user', 'operator'} and password in {'user123', 'operator123'}:
        return {'username': 'user', 'role': 'user', 'token': 'user-token'}
    raise HTTPException(status_code=401, detail='Incorrect ID or password.')


def role_from_token(token: str | None) -> str | None:
    if token == 'superadmin-token':
        return 'superadmin'
    if token == 'admin-token':
        return 'admin'
    if token in {'user-token', 'operator-token'}:
        return 'user'
    return None


def require_role(token: str | None, allowed_roles: set[str]) -> str:
    role = role_from_token(token)
    if role not in allowed_roles:
        raise HTTPException(status_code=403, detail='Permission denied.')
    return role


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


def compressed_recording_geometry(width: int, height: int) -> tuple[int, int]:
    if width <= 0 or height <= 0:
        return width, height
    if width <= RECORDING_MAX_WIDTH:
        return width - (width % 2), height - (height % 2)
    scale = RECORDING_MAX_WIDTH / float(width)
    target_width = RECORDING_MAX_WIDTH
    target_height = int(round(height * scale))
    target_width -= target_width % 2
    target_height -= target_height % 2
    return max(target_width, 2), max(target_height, 2)


def prepare_recording_frame(frame, output_width: int, output_height: int):
    if frame is None:
        return None
    height, width = frame.shape[:2]
    if width == output_width and height == output_height:
        return frame
    return cv2.resize(frame, (output_width, output_height), interpolation=cv2.INTER_AREA)


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
                reason_category TEXT,
                reason TEXT,
                reason_note TEXT,
                reason_submitted_by TEXT,
                reason_submitted_at TEXT,
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
            'reason_category': 'TEXT',
            'reason': 'TEXT',
            'reason_note': 'TEXT',
            'reason_submitted_by': 'TEXT',
            'reason_submitted_at': 'TEXT',
        }.items():
            if column_name not in existing_columns:
                connection.execute(f"ALTER TABLE recordings ADD COLUMN {column_name} {column_type}")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reason_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                reason TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(category, reason)
            )
            """
        )
        now_text = datetime.now().isoformat(timespec='seconds')
        for category, reasons in DEFAULT_REASON_OPTIONS.items():
            for reason in reasons:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO reason_options (category, reason, active, created_at, updated_at)
                    VALUES (?, ?, 1, ?, ?)
                    """,
                    (category, reason, now_text, now_text),
                )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_started_at ON recordings(started_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_camera ON recordings(camera_ip, channel)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_event_type ON recordings(event_type)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_recordings_reason ON recordings(reason_category, reason)")
        connection.execute(
            """
            UPDATE recordings
            SET event_duration_seconds = duration_seconds
            WHERE event_duration_seconds IS NULL
              AND duration_seconds IS NOT NULL
              AND (event_type IN ('minor_stoppage', 'breakdown') OR event_type IS NULL)
            """
        )
    return db_path


def index_event_only_record(
    storage_root: str | Path,
    ip: str,
    channel: int,
    event_type: str,
    event_started_at: datetime,
    event_ended_at: datetime,
) -> dict:
    storage_root = recording_folder(storage_root)
    now_text = datetime.now().isoformat(timespec='seconds')
    duration_seconds = round(max((event_ended_at - event_started_at).total_seconds(), 0), 2)
    file_path = f'event://{safe_camera_folder(ip, channel)}/{event_started_at:%Y%m%d_%H%M%S}'
    record = {
        'file_path': file_path,
        'file_name': f'{event_type}_{event_started_at:%Y%m%d_%H%M%S}',
        'metadata_path': None,
        'storage_root': str(storage_root),
        'camera_ip': ip,
        'channel': channel,
        'started_at': event_started_at.isoformat(timespec='seconds'),
        'ended_at': event_ended_at.isoformat(timespec='seconds'),
        'duration_seconds': None,
        'frames': 0,
        'file_size': 0,
        'status': 'completed',
        'error': None,
        'source_url': None,
        'recording_engine': 'event',
        'audio': 'disabled; timing only',
        'event_type': event_type,
        'event_started_at': event_started_at.isoformat(timespec='seconds'),
        'event_ended_at': event_ended_at.isoformat(timespec='seconds'),
        'event_duration_seconds': duration_seconds,
        'reason_category': None,
        'reason': None,
        'reason_note': None,
        'reason_submitted_by': None,
        'reason_submitted_at': None,
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
                event_ended_at, event_duration_seconds, reason_category, reason, reason_note,
                reason_submitted_by, reason_submitted_at, created_at, updated_at
            )
            VALUES (
                :file_path, :file_name, :metadata_path, :storage_root, :camera_ip, :channel,
                :started_at, :ended_at, :duration_seconds, :frames, :file_size, :status,
                :error, :source_url, :recording_engine, :audio, :event_type, :event_started_at,
                :event_ended_at, :event_duration_seconds, :reason_category, :reason, :reason_note,
                :reason_submitted_by, :reason_submitted_at, :created_at, :updated_at
            )
            ON CONFLICT(file_path) DO UPDATE SET
                file_name = excluded.file_name,
                ended_at = excluded.ended_at,
                status = excluded.status,
                event_type = excluded.event_type,
                event_ended_at = excluded.event_ended_at,
                event_duration_seconds = excluded.event_duration_seconds,
                reason_category = COALESCE(recordings.reason_category, excluded.reason_category),
                reason = COALESCE(recordings.reason, excluded.reason),
                reason_note = COALESCE(recordings.reason_note, excluded.reason_note),
                reason_submitted_by = COALESCE(recordings.reason_submitted_by, excluded.reason_submitted_by),
                reason_submitted_at = COALESCE(recordings.reason_submitted_at, excluded.reason_submitted_at),
                updated_at = excluded.updated_at
            """,
            record,
        )
    return record


def load_sidecar_metadata(video_path: Path) -> dict:
    metadata_path = metadata_path_for(video_path)
    if not metadata_path.exists():
        return {}
    try:
        return json.loads(metadata_path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def index_recording_file(storage_root: str | Path, video_path: Path, metadata: dict | None = None) -> dict:
    storage_root = recording_folder(storage_root)
    video_path = Path(video_path)
    metadata = metadata or load_sidecar_metadata(video_path)
    file_stat = video_path.stat()
    now_text = datetime.now().isoformat(timespec='seconds')
    started_at = metadata.get('started_at') or datetime.fromtimestamp(file_stat.st_mtime).isoformat(timespec='seconds')
    event_type = metadata.get('event_type') or 'minor_stoppage'
    open_auto_breakdown = event_type == 'breakdown' and bool(metadata.get('auto_stopped')) and not metadata.get('event_ended_at')
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
        'event_type': event_type,
        'event_started_at': metadata.get('event_started_at') or started_at,
        'event_ended_at': metadata.get('event_ended_at') or (None if open_auto_breakdown else metadata.get('ended_at')),
        'event_duration_seconds': metadata.get('event_duration_seconds') or (None if open_auto_breakdown else metadata.get('duration_seconds')),
        'reason_category': metadata.get('reason_category'),
        'reason': metadata.get('reason'),
        'reason_note': metadata.get('reason_note'),
        'reason_submitted_by': metadata.get('reason_submitted_by'),
        'reason_submitted_at': metadata.get('reason_submitted_at'),
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
                event_ended_at, event_duration_seconds, reason_category, reason, reason_note,
                reason_submitted_by, reason_submitted_at, created_at, updated_at
            )
            VALUES (
                :file_path, :file_name, :metadata_path, :storage_root, :camera_ip, :channel,
                :started_at, :ended_at, :duration_seconds, :frames, :file_size, :status,
                :error, :source_url, :recording_engine, :audio, :event_type, :event_started_at,
                :event_ended_at, :event_duration_seconds, :reason_category, :reason, :reason_note,
                :reason_submitted_by, :reason_submitted_at, :created_at, :updated_at
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
                reason_category = COALESCE(excluded.reason_category, recordings.reason_category),
                reason = COALESCE(excluded.reason, recordings.reason),
                reason_note = COALESCE(excluded.reason_note, recordings.reason_note),
                reason_submitted_by = COALESCE(excluded.reason_submitted_by, recordings.reason_submitted_by),
                reason_submitted_at = COALESCE(excluded.reason_submitted_at, recordings.reason_submitted_at),
                updated_at = excluded.updated_at
            """,
            record,
        )
    return record


def normalize_reason_category(category: str | None) -> str:
    value = str(category or '').strip().lower()
    if value in {'breakdown', 'minor_stoppage'}:
        return value
    return 'minor_stoppage'


def list_reason_options(storage_root: str | Path) -> dict:
    db_path = init_recording_index(storage_root)
    result = {category: [] for category in DEFAULT_REASON_OPTIONS}
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, category, reason, active
            FROM reason_options
            WHERE active = 1
            ORDER BY category, reason
            """
        ).fetchall()
    for row in rows:
        category = normalize_reason_category(row['category'])
        result.setdefault(category, []).append(dict(row))
    return result


def add_reason_option(request: ReasonRequest) -> dict:
    category = normalize_reason_category(request.category)
    reason = str(request.reason or '').strip()
    if not reason:
        raise ValueError('Reason required.')
    now_text = datetime.now().isoformat(timespec='seconds')
    db_path = init_recording_index(request.storage_root)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO reason_options (category, reason, active, created_at, updated_at)
            VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(category, reason) DO UPDATE SET active = 1, updated_at = excluded.updated_at
            """,
            (category, reason, now_text, now_text),
        )
    return {'category': category, 'reason': reason}


def apply_reason_to_metadata(file_path_text: str | None, reason_data: dict) -> None:
    if not file_path_text or str(file_path_text).startswith('event://'):
        return
    video_path = Path(str(file_path_text))
    sidecar_path = metadata_path_for(video_path)
    metadata = load_sidecar_metadata(video_path)
    metadata.update(reason_data)
    if video_path.exists() or sidecar_path.exists():
        atomic_write_json(sidecar_path, metadata)


def update_recording_reason(request: RecordingReasonRequest) -> dict:
    category = normalize_reason_category(request.event_type)
    reason = str(request.reason or '').strip()
    if not reason:
        raise ValueError('Reason required.')
    now_text = datetime.now().isoformat(timespec='seconds')
    reason_data = {
        'reason_category': category,
        'reason': reason,
        'reason_note': str(request.note or '').strip() or None,
        'reason_submitted_by': str(request.submitted_by or 'Admin').strip() or 'Admin',
        'reason_submitted_at': now_text,
    }
    add_reason_option(ReasonRequest(storage_root=request.storage_root, category=category, reason=reason))

    target_path = str(request.file_path or '').strip()
    with threading.Lock():
        if target_path and recording_state.get('path') and target_path == str(recording_state.get('path')):
            recording_state.update(reason_data)
        elif not target_path and recording_state.get('running'):
            recording_state.update(reason_data)
            target_path = str(recording_state.get('path') or '')

    db_path = init_recording_index(request.storage_root)
    updated = 0
    with sqlite3.connect(db_path) as connection:
        if target_path:
            cursor = connection.execute(
                """
                UPDATE recordings
                SET reason_category = :reason_category,
                    reason = :reason,
                    reason_note = :reason_note,
                    reason_submitted_by = :reason_submitted_by,
                    reason_submitted_at = :reason_submitted_at,
                    updated_at = :updated_at
                WHERE file_path = :file_path
                """,
                {**reason_data, 'updated_at': now_text, 'file_path': target_path},
            )
            updated = cursor.rowcount
        if not updated and request.event_started_at:
            cursor = connection.execute(
                """
                UPDATE recordings
                SET reason_category = :reason_category,
                    reason = :reason,
                    reason_note = :reason_note,
                    reason_submitted_by = :reason_submitted_by,
                    reason_submitted_at = :reason_submitted_at,
                    updated_at = :updated_at
                WHERE event_started_at = :event_started_at
                  AND event_type = :event_type
                """,
                {**reason_data, 'updated_at': now_text, 'event_started_at': request.event_started_at, 'event_type': category},
            )
            updated = cursor.rowcount
            if updated and not target_path:
                row = connection.execute(
                    "SELECT file_path FROM recordings WHERE event_started_at = ? AND event_type = ? ORDER BY updated_at DESC LIMIT 1",
                    (request.event_started_at, category),
                ).fetchone()
                target_path = row[0] if row else ''
    apply_reason_to_metadata(target_path, reason_data)
    return {'ok': True, 'updated': updated, 'file_path': target_path or None, **reason_data}


def scan_recording_index(request: RecordingIndexRequest) -> dict:
    root = recording_folder(request.storage_root)
    db_path = init_recording_index(root)
    indexed = 0
    for video_path in root.rglob('*'):
        if video_path.is_file() and video_path.suffix.lower() in {'.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv', '.dav'}:
            if video_path.stem.endswith('_recording'):
                continue
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
            if file_path and str(file_path).startswith('event://'):
                continue
            if file_path and not Path(file_path).exists():
                missing_paths.append(file_path)
        if missing_paths:
            connection.executemany("DELETE FROM recordings WHERE file_path = ?", [(path,) for path in missing_paths])
    return len(missing_paths)


def parse_iso_datetime(value: object) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def active_recording_index_row(storage_root: str | Path) -> dict | None:
    if not recording_state.get('running'):
        return None
    file_path_text = recording_state.get('path')
    if not file_path_text:
        return None
    file_path = Path(str(file_path_text))
    try:
        root = recording_folder(storage_root).resolve()
        resolved = file_path.resolve()
        if root != resolved and root not in resolved.parents:
            return None
        file_size = resolved.stat().st_size if resolved.exists() else 0
    except Exception:
        file_size = 0

    now_text = datetime.now().isoformat(timespec='seconds')
    started_at = str(recording_state.get('started_at') or now_text)
    event_started_at = str(recording_state.get('event_started_at') or started_at)
    duration_seconds = seconds_since_iso(started_at)
    event_duration_seconds = seconds_since_iso(event_started_at)
    return {
        'id': 'active',
        'file_path': str(file_path),
        'file_name': file_path.name,
        'metadata_path': recording_state.get('metadata_path'),
        'storage_root': normalize_storage_root(storage_root),
        'camera_ip': DEFAULT_CAMERA_IP,
        'channel': 1,
        'started_at': started_at,
        'ended_at': None,
        'duration_seconds': round(duration_seconds, 2) if duration_seconds is not None else None,
        'frames': int(recording_state.get('frames') or 0),
        'file_size': file_size,
        'status': 'running',
        'error': recording_state.get('error'),
        'source_url': recording_state.get('url'),
        'recording_engine': recording_state.get('recording_engine'),
        'audio': recording_state.get('audio'),
        'event_type': recording_state.get('event_type') or 'minor_stoppage',
        'event_started_at': event_started_at,
        'event_ended_at': None,
        'event_duration_seconds': round(event_duration_seconds, 2) if event_duration_seconds is not None else None,
        'reason_category': recording_state.get('reason_category'),
        'reason': recording_state.get('reason'),
        'reason_note': recording_state.get('reason_note'),
        'reason_submitted_by': recording_state.get('reason_submitted_by'),
        'reason_submitted_at': recording_state.get('reason_submitted_at'),
        'created_at': started_at,
        'updated_at': now_text,
    }


def row_matches_index_request(row: dict, request: RecordingIndexRequest) -> bool:
    row_start = parse_iso_datetime(row.get('event_started_at') or row.get('started_at'))
    row_end = parse_iso_datetime(row.get('event_ended_at') or row.get('ended_at')) or datetime.now()
    start_filter = parse_iso_datetime(request.start_at)
    end_filter = parse_iso_datetime(request.end_at)
    if start_filter and row_end < start_filter:
        return False
    if end_filter and row_start and row_start > end_filter:
        return False
    if request.event_type and request.event_type != 'all':
        row_type = row.get('event_type') or 'minor_stoppage'
        if request.event_type == 'minor_stoppage':
            if row_type != 'minor_stoppage':
                return False
        elif request.event_type == 'self_capture':
            if row_type not in {'self_capture', 'manual'}:
                return False
        elif row_type != request.event_type:
            return False
    if request.shift and request.shift != 'all' and row_start:
        row_time = row_start.time()
        if request.shift == 'A' and not (datetime_time(6, 0, 0) <= row_time <= datetime_time(14, 29, 59)):
            return False
        if request.shift == 'B' and not (datetime_time(14, 30, 0) <= row_time <= datetime_time(22, 59, 59)):
            return False
        if request.shift == 'C' and not (row_time >= datetime_time(23, 0, 0) or row_time <= datetime_time(5, 59, 59)):
            return False
    if request.duration_filter in {'under_5', 'over_5'}:
        duration = float(row.get('event_duration_seconds') or row.get('duration_seconds') or 0)
        if request.duration_filter == 'under_5' and duration > 300:
            return False
        if request.duration_filter == 'over_5' and duration <= 300:
            return False
    if request.machine and request.machine != 'all' and row.get('camera_ip') != request.machine:
        return False
    return True


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


def recording_index_where(request: RecordingIndexRequest) -> tuple[str, dict[str, str | int]]:
    where = " WHERE 1=1"
    params: dict[str, str | int] = {}
    if request.start_at:
        where += " AND COALESCE(event_ended_at, ended_at, updated_at, started_at) >= :start_at"
        params['start_at'] = request.start_at
    if request.end_at:
        where += " AND COALESCE(event_started_at, started_at) <= :end_at"
        params['end_at'] = request.end_at
    if request.event_type and request.event_type != 'all':
        if request.event_type == 'minor_stoppage':
            where += " AND (event_type = :event_type OR event_type IS NULL)"
        elif request.event_type == 'self_capture':
            where += " AND event_type IN ('self_capture', 'manual')"
        else:
            where += " AND event_type = :event_type"
        if request.event_type != 'self_capture':
            params['event_type'] = request.event_type
    shift = (request.shift or '').upper()
    event_time_expr = "substr(COALESCE(event_started_at, started_at), 12, 8)"
    if shift == 'A':
        where += f" AND {event_time_expr} >= '06:00:00' AND {event_time_expr} <= '14:29:59'"
    elif shift == 'B':
        where += f" AND {event_time_expr} >= '14:30:00' AND {event_time_expr} <= '22:59:59'"
    elif shift == 'C':
        where += f" AND ({event_time_expr} >= '23:00:00' OR {event_time_expr} <= '05:59:59')"
    if request.duration_filter == 'under_5':
        where += " AND COALESCE(event_duration_seconds, duration_seconds, 0) <= 300"
    elif request.duration_filter == 'over_5':
        where += " AND COALESCE(event_duration_seconds, duration_seconds, 0) > 300"
    if request.machine and request.machine != 'all':
        where += " AND camera_ip = :machine"
        params['machine'] = request.machine
    return where, params


def list_recording_index(request: RecordingIndexRequest) -> dict:
    db_path = init_recording_index(request.storage_root)
    prune_missing_recordings(request.storage_root)
    where, params = recording_index_where(request)
    page_size = min(max(int(request.page_size or 50), 1), 100)
    page = max(int(request.page or 1), 1)
    offset = (page - 1) * page_size
    page_params = {**params, 'limit': page_size, 'offset': offset}

    query = f"SELECT * FROM recordings{where} ORDER BY started_at DESC, updated_at DESC LIMIT :limit OFFSET :offset"
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        total = int(connection.execute(f"SELECT COUNT(*) FROM recordings{where}", params).fetchone()[0])
        records = [dict(row) for row in connection.execute(query, page_params).fetchall()]
    active_row = active_recording_index_row(request.storage_root)
    if active_row and row_matches_index_request(active_row, request):
        duplicate = any(str(record.get('file_path')) == str(active_row.get('file_path')) for record in records)
        if not duplicate and page == 1:
            records = [active_row, *records]
        if not duplicate:
            total += 1
    records = records[:page_size]
    return {'total': total, 'page': page, 'page_size': page_size, 'records': records}


def recording_stats(request: RecordingIndexRequest) -> dict:
    db_path = init_recording_index(request.storage_root)
    prune_missing_recordings(request.storage_root)
    where, params = recording_index_where(request)

    def scalar(connection: sqlite3.Connection, query: str, query_params: dict[str, str | int] | None = None):
        value = connection.execute(query, query_params or {}).fetchone()[0]
        return value or 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        today_total = scalar(connection, f"SELECT COUNT(*) FROM recordings{where}", params)
        today_minor = scalar(connection, f"SELECT COUNT(*) FROM recordings{where} AND (event_type = 'minor_stoppage' OR event_type IS NULL)", params)
        today_breakdown = scalar(connection, f"SELECT COUNT(*) FROM recordings{where} AND event_type = 'breakdown'", params)
        today_recorded = scalar(connection, f"SELECT SUM(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings{where}", params)
        today_breakdown_duration = scalar(connection, f"SELECT SUM(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings{where} AND event_type = 'breakdown'", params)
        today_storage = scalar(connection, f"SELECT SUM(COALESCE(file_size, 0)) FROM recordings{where}", params)
        total_storage = scalar(connection, "SELECT SUM(COALESCE(file_size, 0)) FROM recordings")
        video_count = scalar(connection, "SELECT COUNT(*) FROM recordings")
        avg_file_size = scalar(connection, "SELECT AVG(COALESCE(file_size, 0)) FROM recordings")
        avg_breakdown = scalar(connection, f"SELECT AVG(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings{where} AND event_type = 'breakdown'", params)
        longest_breakdown = scalar(connection, f"SELECT MAX(COALESCE(event_duration_seconds, duration_seconds, 0)) FROM recordings{where} AND event_type = 'breakdown'", params)
        latest_row = connection.execute(
            f"SELECT * FROM recordings{where} ORDER BY started_at DESC, updated_at DESC LIMIT 1",
            params,
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

    active_row = active_recording_index_row(request.storage_root)
    if active_row and row_matches_index_request(active_row, request):
        active_start = parse_iso_datetime(active_row.get('event_started_at') or active_row.get('started_at'))
        active_end = parse_iso_datetime(active_row.get('event_ended_at') or active_row.get('ended_at')) or datetime.now()
        if active_start and active_end:
            today_total += 1
            if active_row.get('event_type') == 'breakdown':
                today_breakdown += 1
                today_breakdown_duration += float(active_row.get('event_duration_seconds') or active_row.get('duration_seconds') or 0)
            else:
                today_minor += 1
            today_recorded += float(active_row.get('event_duration_seconds') or active_row.get('duration_seconds') or 0)
            today_storage += int(active_row.get('file_size') or 0)
        total_storage += int(active_row.get('file_size') or 0)
        video_count += 1
        latest_row = active_row

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


REPORT_COLUMNS = [
    'S.No',
    'Start Date & Time',
    'End Time',
    'Video Duration',
    'Event Duration',
    'File Size',
    'Category',
    'Reason',
    'Remark',
    'Status',
    'Actions',
    'Video Link',
]


def recording_export_records(request: RecordingIndexRequest) -> list[dict]:
    export_request = request.model_copy(update={'page': 1, 'page_size': 100})
    rows = []
    total = 0
    page = 1
    while True:
        page_result = list_recording_index(export_request.model_copy(update={'page': page, 'page_size': 100}))
        total = int(page_result['total'])
        rows.extend(page_result['records'])
        if len(rows) >= total:
            break
        page += 1
    return sorted(rows, key=lambda row: str(row.get('started_at') or ''))


def recording_export_rows(request: RecordingIndexRequest) -> list[list[object]]:
    rows = recording_export_records(request)
    report_rows = []
    for index, row in enumerate(rows, start=1):
        event_duration = row.get('event_duration_seconds') or row.get('duration_seconds') or ''
        report_rows.append([
            index,
            format_report_datetime(row.get('started_at')),
            format_report_time(row.get('event_ended_at') or row.get('ended_at')),
            format_report_duration(row.get('duration_seconds')),
            format_report_duration(event_duration),
            format_report_size(row.get('file_size')),
            event_type_label(row.get('event_type') or 'minor_stoppage'),
            row.get('reason') or 'Pending reason',
            row.get('reason_note') or '',
            report_status_label(row),
            report_action_label(row),
            'View Video' if report_video_url(row, request) else 'No video',
        ])
    return report_rows


def report_date_range_label(request: RecordingIndexRequest) -> str:
    if not request.start_at and not request.end_at:
        return 'All dates'
    start_text = format_report_datetime(request.start_at).split(',')[0] if request.start_at else 'Start'
    end_text = format_report_datetime(request.end_at).split(',')[0] if request.end_at else 'Now'
    return f'{start_text} to {end_text}'


def report_category_label(request: RecordingIndexRequest) -> str:
    if not request.event_type or request.event_type == 'all':
        return 'All Categories'
    return event_type_label(request.event_type)


def recording_export_summary_rows(request: RecordingIndexRequest) -> list[list[object]]:
    stats = recording_stats(request)
    total_events = int(stats.get('today', {}).get('total_events') or 0)
    total_duration = float(stats.get('today', {}).get('recorded_duration_seconds') or 0)
    avg_duration = total_duration / total_events if total_events else 0
    return [
        ['Machine Stoppage Report'],
        ['Date Range', report_date_range_label(request), 'Category', report_category_label(request)],
        [
            'Total Events',
            total_events,
            'Minor Stoppage (< 5 min)',
            int(stats.get('today', {}).get('minor_stoppage_count') or 0),
            'Breakdown (> 5 min)',
            int(stats.get('today', {}).get('breakdown_count') or 0),
            'Storage Used',
            format_report_size(stats.get('today', {}).get('storage_used')),
            'Avg Duration',
            format_report_duration(avg_duration),
        ],
        [],
    ]


def recording_export_csv(request: RecordingIndexRequest) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(REPORT_COLUMNS)
    writer.writerows(recording_export_rows(request))
    return output.getvalue()


def recording_export_xlsx(request: RecordingIndexRequest) -> bytes:
    export_rows = recording_export_rows(request)
    header_row = 1
    rows = [REPORT_COLUMNS, *export_rows]
    hyperlinks = recording_export_hyperlinks(request, start_row=header_row + 1)
    row_styles = {}
    category_col_index = REPORT_COLUMNS.index('Category')
    for offset, row in enumerate(export_rows, start=header_row + 1):
        if len(row) > category_col_index and row[category_col_index] == 'Breakdown':
            row_styles[offset] = 4
    sheet_xml = build_xlsx_sheet(rows, hyperlinks, header_row=header_row, row_styles=row_styles)
    sheet_rels_xml = build_xlsx_sheet_rels(hyperlinks)
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Machine Stoppage" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    workbook_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"""
    root_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"""
    content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"""
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font><font><b/><sz val="13"/><color rgb="FF102A43"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4E6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>"""

    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types_xml)
        archive.writestr('_rels/.rels', root_rels_xml)
        archive.writestr('xl/workbook.xml', workbook_xml)
        archive.writestr('xl/_rels/workbook.xml.rels', workbook_rels_xml)
        archive.writestr('xl/styles.xml', styles_xml)
        archive.writestr('xl/worksheets/sheet1.xml', sheet_xml)
        if hyperlinks:
            archive.writestr('xl/worksheets/_rels/sheet1.xml.rels', sheet_rels_xml)
    return output.getvalue()


def export_metadata_for_row(row: dict) -> dict:
    metadata_path = row.get('metadata_path')
    if not metadata_path:
        return {}
    path = Path(str(metadata_path))
    if not path.exists() or not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def event_type_label(value: str) -> str:
    if value == 'breakdown':
        return 'Breakdown'
    if value == 'minor_stoppage':
        return 'Minor Stoppage'
    if value in {'self_capture', 'manual'}:
        return 'Self Capture'
    return value


def parse_report_datetime(value: object) -> datetime | None:
    if not value:
        return None
    text = str(value)
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def format_report_datetime(value: object) -> str:
    parsed = parse_report_datetime(value)
    if not parsed:
        return str(value or '')
    return parsed.strftime('%d/%m/%Y, %H:%M:%S')


def format_report_time(value: object) -> str:
    parsed = parse_report_datetime(value)
    if not parsed:
        return str(value or '')
    return parsed.strftime('%H:%M:%S')


def format_report_duration(value: object) -> str:
    if value in (None, ''):
        return '-'
    try:
        total_seconds = max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return str(value)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f'{hours:02d}:{minutes:02d}:{seconds:02d}'
    return f'{minutes:02d}:{seconds:02d}'


def format_report_size(value: object) -> str:
    if value in (None, '', 0):
        return '-'
    try:
        size = float(value)
    except (TypeError, ValueError):
        return str(value)
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    if unit_index == 0:
        return f'{int(round(size))} B'
    return f'{size:.1f} {units[unit_index]}'


def report_status_label(row: dict) -> str:
    if row.get('error'):
        return 'Error'
    status = str(row.get('status') or '').replace('_', ' ').strip()
    if not status:
        return 'Saved'
    return status.title()


def report_video_available(row: dict) -> bool:
    file_path = str(row.get('file_path') or '')
    file_size = int(float(row.get('file_size') or 0))
    return bool(file_path and file_size > 1024 and not file_path.startswith('event://') and row.get('recording_engine') != 'event')


def report_action_label(row: dict) -> str:
    return 'Download available' if report_video_available(row) else 'No video'


def normalized_public_helper_url(value: str | None) -> str:
    text = str(value or '').strip().rstrip('/')
    if not text or text.lower() in {'null', 'none', 'undefined'}:
        return ''
    if not text.startswith(('http://', 'https://')):
        text = f'http://{text}'
    return text


def report_video_url(row: dict, request: RecordingIndexRequest) -> str:
    base_url = normalized_public_helper_url(request.public_helper_url) or 'http://127.0.0.1:8010'
    if not report_video_available(row):
        return ''
    storage_root = quote(str(row.get('storage_root') or request.storage_root), safe='')
    file_path = quote(str(row.get('file_path') or ''), safe='')
    return f'{base_url}/recording-file?storage_root={storage_root}&file_path={file_path}'


def recording_export_hyperlinks(request: RecordingIndexRequest, start_row: int = 2) -> dict[str, str]:
    links: dict[str, str] = {}
    row_index = start_row
    link_column = xlsx_column_name(REPORT_COLUMNS.index('Video Link') + 1)
    for row in recording_export_records(request):
        url = report_video_url(row, request)
        if url:
            links[f'{link_column}{row_index}'] = url
        row_index += 1
    return links


def build_xlsx_sheet(
    rows: list[list[object]],
    hyperlinks: dict[str, str] | None = None,
    header_row: int = 1,
    row_styles: dict[int, int] | None = None,
) -> str:
    hyperlinks = hyperlinks or {}
    row_styles = row_styles or {}
    max_row = max(len(rows), 1)
    max_col = max((len(row) for row in rows), default=1)
    last_cell = f'{xlsx_column_name(max_col)}{max_row}'
    xml_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for col_index, value in enumerate(row, start=1):
            cell_ref = f'{xlsx_column_name(col_index)}{row_index}'
            style_id = 1 if row_index == header_row else row_styles.get(row_index, 3 if cell_ref in hyperlinks else 2)
            style = f' s="{style_id}"'
            cells.append(f'<c r="{cell_ref}" t="inlineStr"{style}><is><t>{xlsx_cell_text(value)}</t></is></c>')
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    header_last_cell = f'{xlsx_column_name(max_col)}{header_row}'
    auto_filter = f'<autoFilter ref="A{header_row}:{header_last_cell}"/>' if rows else ''
    hyperlink_xml = ''
    if hyperlinks:
        refs = []
        for index, cell_ref in enumerate(hyperlinks, start=1):
            refs.append(f'<hyperlink ref="{cell_ref}" r:id="rId{index}"/>')
        hyperlink_xml = f'<hyperlinks>{"".join(refs)}</hyperlinks>'
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="A1:{last_cell}"/>'
        f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{header_row}" topLeftCell="A{header_row + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<cols>'
        '<col min="1" max="1" width="8" customWidth="1"/>'
        '<col min="2" max="2" width="23" customWidth="1"/>'
        '<col min="3" max="3" width="14" customWidth="1"/>'
        '<col min="4" max="5" width="16" customWidth="1"/>'
        '<col min="6" max="6" width="14" customWidth="1"/>'
        '<col min="7" max="7" width="20" customWidth="1"/>'
        '<col min="8" max="8" width="14" customWidth="1"/>'
        '<col min="9" max="9" width="22" customWidth="1"/>'
        '<col min="10" max="10" width="18" customWidth="1"/>'
        '</cols>'
        f'<sheetData>{"".join(xml_rows)}</sheetData>'
        f'{auto_filter}'
        f'{hyperlink_xml}'
        '</worksheet>'
    )


def build_xlsx_sheet_rels(hyperlinks: dict[str, str]) -> str:
    relationships = []
    for index, url in enumerate(hyperlinks.values(), start=1):
        relationships.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{xlsx_cell_text(url)}" TargetMode="External"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(relationships)}'
        '</Relationships>'
    )


def xlsx_column_name(index: int) -> str:
    name = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name or 'A'


def xlsx_cell_text(value: object) -> str:
    if value is None:
        return ''
    return xml_escape(str(value), {'"': '&quot;'})


def mjpeg_frames(ip: str, rtsp_port: int, username: str, password: str, channel: int, rtsp_path: str | None = None):
    last_placeholder_at = 0.0
    last_frame_jpeg = None
    last_frame_at = 0.0
    frame_delay = 1.0 / max(LIVE_PREVIEW_TARGET_FPS, 1.0)
    ensure_shared_camera_worker(ip, rtsp_port, username, password, channel, rtsp_path)
    while True:
        frame, _, _ = latest_shared_frame(max_age_seconds=LIVE_PREVIEW_STALE_SECONDS)
        if frame is None:
            now = time.monotonic()
            if last_frame_jpeg and now - last_frame_at <= LIVE_PREVIEW_STALE_SECONDS:
                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n\r\n'
                    + last_frame_jpeg
                    + b'\r\n'
                )
            elif now - last_placeholder_at >= 0.5:
                last_placeholder_at = now
                placeholder = placeholder_jpeg()
                if placeholder:
                    yield (
                        b'--frame\r\n'
                        b'Content-Type: image/jpeg\r\n\r\n'
                        + placeholder
                        + b'\r\n'
                    )
            time.sleep(frame_delay)
            continue
        frame = prepare_live_preview_frame(frame)
        ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 68])
        if ok:
            last_frame_jpeg = encoded.tobytes()
            last_frame_at = time.monotonic()
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n'
                + last_frame_jpeg
                + b'\r\n'
            )
        time.sleep(frame_delay)


def record_camera_ffmpeg_worker(request: RecordingRequest) -> bool:
    global recording_process, recording_state
    ffmpeg_path = ffmpeg_executable()
    if not ffmpeg_path:
        return False

    started_at = datetime.now()
    _, output_path, final_path = build_recording_paths(request.storage_root, request.ip, request.channel, started_at)
    candidate_urls = rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path)
    ensure_shared_camera_worker(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path)
    shared_url = latest_shared_rtsp_url()
    working_url = shared_url or candidate_urls[0]
    ffmpeg_success = False
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
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        str(RECORDING_CRF),
        '-vf',
        f'scale=min({RECORDING_MAX_WIDTH}\\,iw):-2,fps={RECORDING_TARGET_FPS:g}',
        '-c:a',
        'aac',
        '-af',
        RECORDING_AUDIO_FILTER,
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        str(output_path),
    ]

    try:
        recording_process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while not recording_stop_event.is_set() and recording_process.poll() is None:
            time.sleep(0.25)
        if recording_stop_event.is_set() and recording_process.poll() is None:
            try:
                recording_process.communicate(input=b'q', timeout=20)
            except subprocess.TimeoutExpired:
                recording_process.terminate()
                try:
                    recording_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    recording_process.kill()
        stderr = b''
        if recording_process and recording_process.returncode not in (0, None) and (not output_path.exists() or output_path.stat().st_size == 0):
            recording_state['error'] = stderr.decode(errors='ignore') or f'FFmpeg exited with {recording_process.returncode}'
    except Exception as exc:
        recording_state['error'] = str(exc)
    finally:
        ended_at = datetime.now()
        duration_seconds = max((ended_at - started_at).total_seconds(), 0)
        event_type = recording_state.get('event_type') or request.event_type
        auto_stopped_breakdown = bool(recording_state.get('auto_stopped')) and event_type == 'breakdown'
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
            'compression': {
                'max_width': RECORDING_MAX_WIDTH,
                'target_fps': RECORDING_TARGET_FPS,
                'video_codec': 'libx264',
                'crf': RECORDING_CRF,
                'profile': 'storage-balanced',
                'audio_filter': RECORDING_AUDIO_FILTER,
            },
            'auto_stopped': bool(recording_state.get('auto_stopped')),
            'event_type': event_type,
            'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
            'event_ended_at': recording_state.get('event_ended_at') or (None if auto_stopped_breakdown else ended_at.isoformat(timespec='seconds')),
            'event_duration_seconds': recording_state.get('event_duration_seconds') or (None if auto_stopped_breakdown else round(duration_seconds, 2)),
            'reason_category': recording_state.get('reason_category'),
            'reason': recording_state.get('reason'),
            'reason_note': recording_state.get('reason_note'),
            'reason_submitted_by': recording_state.get('reason_submitted_by'),
            'reason_submitted_at': recording_state.get('reason_submitted_at'),
        }
        if output_path.exists() and output_path.stat().st_size > 0 and not recording_state.get('error'):
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
            ffmpeg_success = True
        recording_state['ended_at'] = ended_at.isoformat(timespec='seconds')
        recording_state['duration_seconds'] = round(duration_seconds, 2)
        recording_state['running'] = False
        recording_process = None
    return ffmpeg_success or recording_stop_event.is_set()


def record_camera_worker(request: RecordingRequest):
    global recording_state
    if USE_FFMPEG_RECORDING and record_camera_ffmpeg_worker(request):
        return
    recording_state.update(
        {
            'running': True,
            'path': None,
            'metadata_path': None,
            'error': None,
            'frames': 0,
            'audio': 'disabled; ffmpeg failed, using video-only fallback',
            'recording_engine': 'opencv',
            'event_type': recording_state.get('event_type') or request.event_type,
            'event_started_at': recording_state.get('event_started_at') or datetime.now().isoformat(timespec='seconds'),
            'event_ended_at': None,
            'event_duration_seconds': None,
        }
    )
    capture = None
    writer = None
    output_path = None
    final_path = None
    started_at = datetime.now()
    fps = 15.0
    width = None
    height = None
    output_width = None
    output_height = None
    source_fps = 15.0
    codec_used = None
    try:
        working_url = None
        first_frame = None
        ensure_shared_camera_worker(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path)
        wait_until = time.monotonic() + 5.0
        while time.monotonic() < wait_until:
            first_frame, working_url, source_fps = latest_shared_frame(max_age_seconds=2.0)
            if first_frame is not None:
                break
            time.sleep(0.05)

        if first_frame is None:
            for url in rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path):
                capture = cv2.VideoCapture()
                capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, RTSP_RECORD_OPEN_TIMEOUT_MS)
                capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, RTSP_RECORD_OPEN_TIMEOUT_MS)
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
            if first_frame is None or working_url is None:
                raise RuntimeError('Camera RTSP stream open nahi hua.')

        height, width = first_frame.shape[:2]
        if capture is not None:
            source_fps = capture.get(cv2.CAP_PROP_FPS)
        if source_fps <= 0 or source_fps > 60:
            source_fps = 15.0
        fps = min(float(source_fps), RECORDING_TARGET_FPS)
        output_width, output_height = compressed_recording_geometry(width, height)

        _, output_path, final_path = build_recording_paths(request.storage_root, request.ip, request.channel, started_at)
        codec_used = None
        for codec_name in ('mp4v', 'avc1', 'H264', 'X264'):
            writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*codec_name), fps, (output_width, output_height))
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
                'recording_quality': f'compressed {output_width}x{output_height} @ {fps:.1f}fps',
                'event_type': request.event_type,
                'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
                'event_ended_at': None,
                'event_duration_seconds': None,
                'auto_stopped': False,
            }
        )

        first_output_frame = prepare_recording_frame(first_frame, output_width, output_height)
        writer.write(first_output_frame)
        recording_state['frames'] = 1
        last_output_frame = first_output_frame
        frame_interval = 1.0 / max(float(fps), 1.0)
        next_write_at = time.monotonic() + frame_interval

        def write_due_frames(frame, now_monotonic: float):
            nonlocal next_write_at
            if frame is None or now_monotonic < next_write_at:
                return 0
            frames_written = 0
            max_burst_frames = max(int(float(fps) * 3), 1)
            while next_write_at <= now_monotonic and frames_written < max_burst_frames:
                writer.write(frame)
                frames_written += 1
                next_write_at += frame_interval
            recording_state['frames'] = int(recording_state.get('frames') or 0) + frames_written
            return frames_written

        while not recording_stop_event.is_set():
            if capture is None:
                frame, _, _ = latest_shared_frame(max_age_seconds=2.0)
                ok = frame is not None
            else:
                ok, frame = capture.read()
            now_monotonic = time.monotonic()
            if not ok or frame is None:
                write_due_frames(last_output_frame, now_monotonic)
                time.sleep(0.1)
                continue
            output_frame = prepare_recording_frame(frame, output_width, output_height)
            last_output_frame = output_frame
            write_due_frames(output_frame, now_monotonic)
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
        event_type = recording_state.get('event_type') or request.event_type
        auto_stopped_breakdown = bool(recording_state.get('auto_stopped')) and event_type == 'breakdown'
        metadata = {
            'camera_ip': request.ip,
            'channel': request.channel,
            'started_at': started_at.isoformat(timespec='seconds'),
            'ended_at': ended_at.isoformat(timespec='seconds'),
            'duration_seconds': round(duration_seconds, 2),
            'frames': frames,
            'fps': round(float(fps), 2),
            'width': output_width,
            'height': output_height,
            'source_width': width,
            'source_height': height,
            'source_fps': round(float(source_fps), 2),
            'codec': codec_used,
            'compression': {
                'max_width': RECORDING_MAX_WIDTH,
                'target_fps': RECORDING_TARGET_FPS,
                'profile': 'storage-balanced',
            },
            'status': 'failed' if recording_state.get('error') else 'completed',
            'error': recording_state.get('error'),
            'source_url': recording_state.get('url'),
            'recording_engine': 'opencv',
            'audio': 'disabled; install ffmpeg for audio',
            'auto_stopped': bool(recording_state.get('auto_stopped')),
            'event_type': event_type,
            'event_started_at': recording_state.get('event_started_at') or started_at.isoformat(timespec='seconds'),
            'event_ended_at': recording_state.get('event_ended_at') or (None if auto_stopped_breakdown else ended_at.isoformat(timespec='seconds')),
            'event_duration_seconds': recording_state.get('event_duration_seconds') or (None if auto_stopped_breakdown else round(duration_seconds, 2)),
            'reason_category': recording_state.get('reason_category'),
            'reason': recording_state.get('reason'),
            'reason_note': recording_state.get('reason_note'),
            'reason_submitted_by': recording_state.get('reason_submitted_by'),
            'reason_submitted_at': recording_state.get('reason_submitted_at'),
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
    ensure_shared_camera_worker(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path)
    time.sleep(8.0)
    frame, url, _ = latest_shared_frame(max_age_seconds=10.0)
    if frame is not None:
        return {'ok': True, 'method': 'rtsp', 'url': hide_secret(url or '', request.password)}
    if tcp_reachable(request.ip, request.rtsp_port):
        raise HTTPException(
            status_code=400,
            detail='RTSP port reachable but no video frame received. Check camera password, RTSP enabled setting, channel, and stream path.',
        )
    raise HTTPException(status_code=400, detail='Camera RTSP port is not reachable.')


@app.post('/camera-diagnostics')
def camera_diagnostics(request: CameraRequest):
    http_candidates = camera_base_url_candidates(request.ip, request.http_port)
    rtsp_candidates = rtsp_urls(
        request.ip,
        request.rtsp_port,
        request.username,
        request.password,
        request.channel,
        request.rtsp_path,
    )
    http_reachable = tcp_reachable(request.ip, request.http_port, timeout=2.0)
    rtsp_reachable = tcp_reachable(request.ip, request.rtsp_port, timeout=2.0)
    frame, url, _ = latest_shared_frame(max_age_seconds=5.0)
    with shared_camera_lock:
        worker_key = shared_camera_state.get('key')
        worker_running = shared_camera_state.get('running')
        worker_error = shared_camera_state.get('last_error')

    if not rtsp_reachable:
        likely_cause = (
            f'RTSP {request.ip}:{request.rtsp_port} is not reachable from this helper PC. '
            'This is normally network route/VLAN/firewall/camera RTSP service, not React UI.'
        )
    elif frame is None:
        likely_cause = (
            'RTSP TCP is reachable but no frame is available. Check camera credentials, RTSP enabled setting, '
            'channel number, and stream path.'
        )
    else:
        likely_cause = 'Camera stream is producing frames.'

    return {
        'ip': request.ip,
        'configured': {
            'http_port': request.http_port,
            'rtsp_port': request.rtsp_port,
            'channel': request.channel,
            'rtsp_path': normalize_rtsp_path(request.rtsp_path, request.channel),
        },
        'tcp': {
            'http_reachable': http_reachable,
            'rtsp_reachable': rtsp_reachable,
        },
        'http_base_candidates': http_candidates,
        'rtsp_url_candidates': [hide_secret(item, request.password) for item in rtsp_candidates[:8]],
        'shared_worker': {
            'running': worker_running,
            'same_camera': worker_key == shared_camera_key(
                request.ip,
                request.rtsp_port,
                request.username,
                request.password,
                request.channel,
                request.rtsp_path,
            ),
            'has_recent_frame': frame is not None,
            'url': hide_secret(url or '', request.password),
            'last_error': worker_error,
        },
        'likely_cause': likely_cause,
    }


@app.post('/auth/login')
def auth_login(request: LoginRequest):
    return auth_session(request.username, request.password)


@app.post('/auth/elevate')
def auth_elevate(request: LoginRequest):
    if request.username.strip().lower() != 'admin':
        raise HTTPException(status_code=401, detail='Incorrect ID or password.')
    return auth_session(request.username, request.password)


@app.post('/recordings')
def recordings(request: CameraRequest):
    if not request.start_at or not request.end_at:
        raise HTTPException(status_code=400, detail='start_at and end_at are required')
    try:
        http, session_id, base_url = login_camera(request.ip, request.http_port, request.username, request.password)
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
        http, session_id, base_url = login_camera(request.ip, request.http_port, request.username, request.password)
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
    ensure_shared_camera_worker(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path)
    frame, url, _ = latest_shared_frame(max_age_seconds=2.0)
    if frame is not None:
        ok, encoded = cv2.imencode('.jpg', frame)
        if ok:
            return {'url': url, 'frame': base64.b64encode(encoded.tobytes()).decode()}

    errors = []
    http = requests.Session()
    for url in snapshot_urls(request.ip, request.http_port, request.channel):
        try:
            response = http.get(url, auth=(request.username, request.password), timeout=10, verify=False)
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

    for url in rtsp_urls(request.ip, request.rtsp_port, request.username, request.password, request.channel, request.rtsp_path):
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
    rtsp_path: str | None = None,
):
    return StreamingResponse(
        mjpeg_frames(ip, rtsp_port, username, password, channel, rtsp_path),
        media_type='multipart/x-mixed-replace; boundary=frame',
    )


def live_audio_response(
    ip: str,
    rtsp_port: int,
    username: str,
    password: str,
    channel: int,
    rtsp_path: str | None = None,
):
    ffmpeg_path = ffmpeg_executable()
    if not ffmpeg_path:
        raise HTTPException(status_code=503, detail='FFmpeg is required for live audio.')

    ensure_shared_camera_worker(ip, rtsp_port, username, password, channel, rtsp_path)
    working_url = latest_shared_rtsp_url() or rtsp_urls(ip, rtsp_port, username, password, channel, rtsp_path)[0]
    command = [
        ffmpeg_path,
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-rtsp_transport',
        'tcp',
        '-i',
        working_url,
        '-vn',
        '-af',
        RECORDING_AUDIO_FILTER,
        '-ac',
        '1',
        '-ar',
        '22050',
        '-f',
        'mp3',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        'pipe:1',
    ]

    def stream_audio():
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            if not process.stdout:
                return
            while True:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                yield chunk
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()

    return StreamingResponse(stream_audio(), media_type='audio/mpeg')


@app.get('/audio.mp3')
def audio_stream(
    ip: str,
    rtsp_port: int = 554,
    username: str = 'admin',
    password: str = '',
    channel: int = 1,
    rtsp_path: str | None = None,
):
    return live_audio_response(ip, rtsp_port, username, password, channel, rtsp_path)


@app.get('/audio.wav')
def legacy_audio_stream(
    ip: str,
    rtsp_port: int = 554,
    username: str = 'admin',
    password: str = '',
    channel: int = 1,
    rtsp_path: str | None = None,
):
    return live_audio_response(ip, rtsp_port, username, password, channel, rtsp_path)


@app.get('/recording/status')
def recording_status():
    status = dict(recording_state)
    status['compression_settings'] = {
        'max_width': RECORDING_MAX_WIDTH,
        'target_fps': RECORDING_TARGET_FPS,
        'crf': RECORDING_CRF,
        'profile': 'storage-balanced',
        'audio_filter': RECORDING_AUDIO_FILTER,
    }
    status['ffmpeg_available'] = bool(ffmpeg_executable())
    with shared_camera_lock:
        frame_at = shared_camera_state.get('frame_at')
        status['shared_camera'] = {
            'running': shared_camera_state.get('running'),
            'has_frame': shared_camera_state.get('frame') is not None,
            'frame_age_seconds': round(time.monotonic() - float(frame_at), 2) if frame_at else None,
            'width': shared_camera_state.get('width'),
            'height': shared_camera_state.get('height'),
            'fps': shared_camera_state.get('fps'),
            'last_error': shared_camera_state.get('last_error'),
        }
    return status


def start_recording_internal(request: RecordingRequest):
    global recording_thread
    if request.event_type == 'manual':
        request.event_type = 'self_capture'
    if request.event_type not in {'minor_stoppage', 'breakdown', 'self_capture'}:
        raise HTTPException(
            status_code=400,
            detail='Only manual and Gate Trigger recordings are allowed.',
        )
    if recording_state.get('running') or (recording_thread and recording_thread.is_alive()):
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
            'reason_category': None,
            'reason': None,
            'reason_note': None,
            'reason_submitted_by': None,
            'reason_submitted_at': None,
            'auto_stopped': False,
        }
    )
    recording_thread = threading.Thread(target=record_camera_worker, args=(request,), daemon=True)
    recording_thread.start()
    return recording_state


@app.post('/recording/start')
def start_recording(request: RecordingRequest, x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin', 'admin'})
    return start_recording_internal(request)


def stop_recording_internal():
    recording_stop_event.set()
    if recording_thread and recording_thread.is_alive():
        recording_thread.join(timeout=5)
    return recording_state


@app.post('/recording/stop')
def stop_recording(x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin', 'admin'})
    return stop_recording_internal()


def plc_monitor_worker(request: PlcMonitorRequest):
    worker_started_at = datetime.now()
    if not plc_monitor_state.get('enabled', False):
        plc_monitor_state.update(
            {
                'running': False,
                'machine_state': None,
                'machine_state_started_at': None,
                'machine_state_duration_seconds': 0,
                'last_action': f'Gate trigger is off; PLC monitor not started at {datetime.now().isoformat(timespec="seconds")}.',
            }
        )
        return
    plc_monitor_state.update(
        {
            'running': True,
            'camera_ip': request.ip,
            'http_port': request.http_port,
            'rtsp_port': request.rtsp_port,
            'channel': request.channel,
            'storage_root': request.storage_root,
            'capture_video': bool(request.capture_video),
            'capture_breakdown_video': bool(request.capture_breakdown_video),
            'plc_host': request.plc_host,
            'plc_port': request.plc_port,
            'plc_device': request.plc_device,
            'gate_open_addresses': list(request.gate_open_addresses),
            'gate_close_addresses': list(request.gate_close_addresses),
            'gate_open_when': bool(request.gate_open_when),
            'gate_close_when': bool(request.gate_close_when),
            'max_record_seconds': max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1),
            'gate_open': False,
            'gate_close': False,
            'machine_state': 'running',
            'machine_state_started_at': worker_started_at.isoformat(timespec='seconds'),
            'machine_state_duration_seconds': 0,
            'current_event_type': None,
            'current_event_started_at': None,
            'current_event_duration_seconds': None,
            'last_gate_opened_at': None,
            'last_gate_closed_at': None,
            'last_action': None,
            'last_read_at': None,
            'last_error': None,
            'open_values': {},
            'close_values': {},
        }
    )
    previous_open = None
    previous_close = False
    gate_cycle_maxed_out = False
    gate_event_started_at: datetime | None = None
    machine_state_started_at: datetime = worker_started_at
    breakdown_marked = False
    last_start_attempt_at = 0.0
    last_closed_monotonic = 0.0
    poll_seconds = max(float(request.poll_seconds), 0.2)

    while not plc_monitor_stop_event.is_set():
        if not plc_monitor_state.get('enabled', False):
            plc_monitor_state['last_action'] = f'Gate trigger disabled at {datetime.now().isoformat(timespec="seconds")}.'
            break
        errors = []
        try:
            open_values, close_values, errors, active_plc_port = read_plc_failover(request)
            if active_plc_port is not None:
                request.plc_port = active_plc_port
                plc_monitor_state['plc_port'] = active_plc_port

            plc_read_failed = bool(errors) and not open_values and not close_values
            active_gate_event = bool(gate_event_started_at) or (
                recording_state.get('running')
                and recording_state.get('event_type') in {'minor_stoppage', 'breakdown'}
            )
            if plc_read_failed:
                gate_open = bool(previous_open) or active_gate_event
                gate_close = False
            else:
                gate_open = any(value == bool(request.gate_open_when) for value in open_values.values())
                gate_close = any(value == bool(request.gate_close_when) for value in close_values.values())
            now = datetime.now()
            max_record_seconds = max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1)
            if gate_open and (previous_open is False or previous_open is None) and gate_event_started_at is None:
                gate_event_started_at = now
                machine_state_started_at = now
                breakdown_marked = False
                recording_state['event_type'] = 'minor_stoppage'
                recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                plc_monitor_state['last_gate_opened_at'] = gate_event_started_at.isoformat(timespec='seconds')
            event_elapsed_seconds = (
                round((now - gate_event_started_at).total_seconds(), 2)
                if gate_open and gate_event_started_at
                else None
            )
            if gate_open and event_elapsed_seconds is not None and event_elapsed_seconds >= max_record_seconds:
                breakdown_marked = True
                recording_state['event_type'] = 'breakdown'
                recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
            current_event_type = None
            current_event_started_at = None
            current_event_duration_seconds = None
            machine_state = plc_monitor_state.get('machine_state') or 'running'
            machine_state_started_text = machine_state_started_at.isoformat(timespec='seconds')
            if gate_open:
                current_event_type = 'breakdown' if recording_state.get('event_type') == 'breakdown' or breakdown_marked or gate_cycle_maxed_out else 'minor_stoppage'
                current_event_started_at = (
                    gate_event_started_at.isoformat(timespec='seconds')
                    if gate_event_started_at
                    else recording_state.get('event_started_at')
                )
                current_event_duration_seconds = event_elapsed_seconds if event_elapsed_seconds is not None else seconds_since_iso(current_event_started_at)
                machine_state = current_event_type
                machine_state_started_text = current_event_started_at
            elif gate_close:
                machine_state = 'running'
                machine_state_started_text = machine_state_started_at.isoformat(timespec='seconds')
            plc_monitor_state.update(
                {
                    'gate_open': gate_open,
                    'gate_close': gate_close,
                    'machine_state': machine_state,
                    'machine_state_started_at': machine_state_started_text,
                    'machine_state_duration_seconds': round(seconds_since_iso(machine_state_started_text) or 0, 2),
                    'current_event_type': current_event_type,
                    'current_event_started_at': current_event_started_at,
                    'current_event_duration_seconds': current_event_duration_seconds,
                    'last_read_at': datetime.now().isoformat(timespec='seconds'),
                    'last_error': '; '.join(errors[-3:]) if errors else None,
                    'open_values': open_values,
                    'close_values': close_values,
                    'plc_port': active_plc_port or plc_monitor_state.get('plc_port') or request.plc_port,
                }
            )

            should_try_start = (
                gate_open
                and request.capture_video
                and not gate_cycle_maxed_out
                and not recording_state.get('running')
                and not recording_state.get('auto_stopped')
                and time.monotonic() - last_closed_monotonic >= GATE_CLOSE_START_COOLDOWN_SECONDS
            )
            start_retry_due = time.monotonic() - last_start_attempt_at >= RECORDING_START_RETRY_SECONDS
            if should_try_start and (not previous_open or start_retry_due):
                last_start_attempt_at = time.monotonic()
                if gate_event_started_at is None:
                    gate_event_started_at = datetime.now()
                    breakdown_marked = False
                request.event_type = 'minor_stoppage'
                start_recording_internal(request)
                recording_state['event_type'] = 'minor_stoppage'
                recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                plc_monitor_state['current_event_type'] = 'minor_stoppage'
                plc_monitor_state['current_event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                plc_monitor_state['last_action'] = f'Auto recording started on {request.plc_device.upper()} signal OFF at {datetime.now().isoformat(timespec="seconds")}'
            elif gate_open and not request.capture_video and (previous_open is False or previous_open is None):
                plc_monitor_state['last_action'] = f'Timing-only event started on {request.plc_device.upper()} signal OFF at {datetime.now().isoformat(timespec="seconds")}'

            recording_age = current_recording_age_seconds()

            if (
                gate_open
                and breakdown_marked
                and recording_state.get('running')
                and 'Breakdown recording continues' not in str(plc_monitor_state.get('last_action') or '')
            ):
                plc_monitor_state['last_action'] = (
                    f'Breakdown recording continues after minor stoppage limit {max_record_seconds}s at '
                    f'{datetime.now().isoformat(timespec="seconds")}.'
                )

            if gate_close and not previous_close:
                closed_at = datetime.now()
                event_duration_seconds = (
                    round((closed_at - gate_event_started_at).total_seconds(), 2)
                    if gate_event_started_at
                    else None
                )
                close_event_type = (
                    'breakdown'
                    if breakdown_marked or (event_duration_seconds is not None and event_duration_seconds >= max_record_seconds)
                    else 'minor_stoppage'
                )
                if recording_state.get('running'):
                    recording_state['event_type'] = close_event_type
                    recording_state['event_ended_at'] = closed_at.isoformat(timespec='seconds')
                    if event_duration_seconds is not None:
                        recording_state['event_duration_seconds'] = event_duration_seconds
                    stop_recording_internal()
                    label = 'Breakdown' if close_event_type == 'breakdown' else 'Minor stoppage'
                    if recording_state.get('metadata_path') and not recording_state.get('error'):
                        plc_monitor_state['last_action'] = f'{label} saved on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
                    elif gate_event_started_at:
                        index_event_only_record(
                            request.storage_root,
                            request.ip,
                            request.channel,
                            close_event_type,
                            gate_event_started_at,
                            closed_at,
                        )
                        plc_monitor_state['last_action'] = f'{label} timing saved after video failure on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
                elif gate_event_started_at and (not request.capture_video or not recording_state.get('metadata_path')):
                    index_event_only_record(
                        request.storage_root,
                        request.ip,
                        request.channel,
                        close_event_type,
                        gate_event_started_at,
                        closed_at,
                    )
                    recording_state['event_type'] = close_event_type
                    recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                    recording_state['event_ended_at'] = closed_at.isoformat(timespec='seconds')
                    recording_state['event_duration_seconds'] = event_duration_seconds
                    label = 'Breakdown' if close_event_type == 'breakdown' else 'Minor stoppage'
                    reason = 'without video' if not request.capture_video else 'after video failure'
                    plc_monitor_state['last_action'] = f'{label} timing saved {reason} on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
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
                    recording_state['event_duration_seconds'] = event_duration_seconds
                    plc_monitor_state['last_action'] = f'Breakdown closed on {request.plc_device.upper()} signal ON at {closed_at.isoformat(timespec="seconds")}'
                gate_event_started_at = None
                breakdown_marked = False
                gate_cycle_maxed_out = False
                recording_state['auto_stopped'] = False
                last_closed_monotonic = time.monotonic()
                machine_state_started_at = closed_at
                plc_monitor_state['machine_state'] = 'running'
                plc_monitor_state['machine_state_started_at'] = machine_state_started_at.isoformat(timespec='seconds')
                plc_monitor_state['machine_state_duration_seconds'] = 0
                plc_monitor_state['current_event_type'] = None
                plc_monitor_state['current_event_started_at'] = None
                plc_monitor_state['current_event_duration_seconds'] = None
                plc_monitor_state['last_gate_closed_at'] = closed_at.isoformat(timespec='seconds')

            if gate_open and recording_state.get('running') and recording_age is not None and recording_age >= max_record_seconds:
                recording_state['event_type'] = 'breakdown'
                if gate_event_started_at:
                    recording_state['event_started_at'] = gate_event_started_at.isoformat(timespec='seconds')
                recording_state['event_ended_at'] = None
                recording_state['event_duration_seconds'] = None
                gate_cycle_maxed_out = True
                breakdown_marked = True
                if not request.capture_breakdown_video:
                    recording_state['auto_stopped'] = True
                    stop_recording_internal()
                plc_monitor_state['machine_state'] = 'breakdown'
                plc_monitor_state['machine_state_started_at'] = (
                    gate_event_started_at.isoformat(timespec='seconds')
                    if gate_event_started_at
                    else recording_state.get('event_started_at')
                )
                plc_monitor_state['current_event_type'] = 'breakdown'
                plc_monitor_state['current_event_started_at'] = (
                    gate_event_started_at.isoformat(timespec='seconds')
                    if gate_event_started_at
                    else recording_state.get('event_started_at')
                )
                if 'Breakdown started after minor stoppage limit' not in str(plc_monitor_state.get('last_action') or ''):
                    plc_monitor_state['last_action'] = (
                        f'Breakdown started after minor stoppage limit {max_record_seconds}s; '
                        f'video {"continues until gate close" if request.capture_breakdown_video else "stopped at minor stoppage limit"}.'
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
    if plc_monitor_state.get('enabled', False):
        ensure_auto_plc_monitor_running()
    state = dict(plc_monitor_state)
    state['machine_state_duration_seconds'] = round(seconds_since_iso(state.get('machine_state_started_at')) or 0, 2)
    current_event_started_at = state.get('current_event_started_at')
    state['current_event_duration_seconds'] = (
        round(seconds_since_iso(current_event_started_at) or 0, 2)
        if current_event_started_at
        else None
    )
    return state


@app.get('/settings')
def get_settings():
    return load_helper_settings().model_dump()


@app.post('/settings')
def update_settings(settings: HelperSettings, x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin'})
    saved = save_helper_settings(settings)
    if saved.plc_enabled:
        start_plc_monitor_internal(settings_to_plc_request(saved))
    else:
        plc_monitor_state['enabled'] = False
        plc_monitor_stop_event.set()
        ensure_shared_camera_worker(saved.ip, saved.rtsp_port, saved.username, saved.password, saved.channel, saved.rtsp_path)
    return saved.model_dump()


def start_plc_monitor_internal(request: PlcMonitorRequest):
    global plc_monitor_thread
    save_helper_settings(
        HelperSettings(
            ip=request.ip,
            http_port=request.http_port,
            rtsp_port=request.rtsp_port,
            username=request.username,
            password=request.password,
            channel=request.channel,
            rtsp_path=request.rtsp_path,
            storage_root=request.storage_root,
            capture_video=request.capture_video,
            capture_breakdown_video=request.capture_breakdown_video,
            plc_host=request.plc_host,
            plc_port=request.plc_port,
            plc_device=request.plc_device,
            plc_address=str((request.gate_open_addresses or request.gate_close_addresses or ['4A'])[0]),
            max_record_seconds=request.max_record_seconds,
        )
    )
    plc_monitor_state['enabled'] = True
    if plc_monitor_state.get('running') and plc_monitor_thread and plc_monitor_thread.is_alive():
        same_request = (
            plc_monitor_state.get('camera_ip') == request.ip
            and int(plc_monitor_state.get('http_port') or 80) == int(request.http_port)
            and int(plc_monitor_state.get('rtsp_port') or 554) == int(request.rtsp_port)
            and int(plc_monitor_state.get('channel') or 1) == int(request.channel)
            and normalize_storage_root(plc_monitor_state.get('storage_root') or DEFAULT_STORAGE_ROOT) == normalize_storage_root(request.storage_root)
            and bool(plc_monitor_state.get('capture_video', True)) == bool(request.capture_video)
            and bool(plc_monitor_state.get('capture_breakdown_video', True)) == bool(request.capture_breakdown_video)
            and plc_monitor_state.get('plc_host') == request.plc_host
            and int(plc_monitor_state.get('plc_port') or 0) in plc_candidate_ports(request.plc_port)
            and str(plc_monitor_state.get('plc_device') or '').upper() == request.plc_device.upper()
            and list(plc_monitor_state.get('gate_open_addresses') or []) == list(request.gate_open_addresses)
            and list(plc_monitor_state.get('gate_close_addresses') or []) == list(request.gate_close_addresses)
            and bool(plc_monitor_state.get('gate_open_when')) == bool(request.gate_open_when)
            and bool(plc_monitor_state.get('gate_close_when')) == bool(request.gate_close_when)
            and int(plc_monitor_state.get('max_record_seconds') or MAX_GATE_RECORD_SECONDS) == max(int(request.max_record_seconds or MAX_GATE_RECORD_SECONDS), 1)
        )
        if same_request:
            return plc_monitor_state
        plc_monitor_stop_event.set()
        plc_monitor_thread.join(timeout=3)

    plc_monitor_stop_event.clear()
    plc_monitor_thread = threading.Thread(target=plc_monitor_worker, args=(request,), daemon=True)
    plc_monitor_thread.start()
    return plc_monitor_state


@app.post('/plc-monitor/start')
def start_plc_monitor(request: PlcMonitorRequest, x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin', 'admin'})
    return start_plc_monitor_internal(request)


@app.post('/plc-test')
def plc_test(request: PlcMonitorRequest, x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin'})
    tested_ports = []
    selected_port = None
    reachable = False
    result = {
        'reachable': False,
        'ok': False,
        'host': request.plc_host,
        'port': request.plc_port,
        'device': request.plc_device,
        'open_addresses': list(request.gate_open_addresses),
        'close_addresses': list(request.gate_close_addresses),
        'open_values': {},
        'close_values': {},
        'errors': [],
        'message': '',
    }
    for port in plc_candidate_ports(request.plc_port):
        tested_ports.append(port)
        if tcp_reachable(request.plc_host, port, timeout=3.0):
            reachable = True
            selected_port = port
            break
    result['reachable'] = reachable
    result['tested_ports'] = tested_ports
    if not reachable or selected_port is None:
        result['message'] = f'PLC TCP port not reachable on {request.plc_host}: {", ".join(str(port) for port in tested_ports)}'
        return result
    result['port'] = selected_port
    open_values, open_errors = read_plc_addresses(request, request.gate_open_addresses, selected_port)
    close_values, close_errors = read_plc_addresses(request, request.gate_close_addresses, selected_port)
    errors = [*open_errors, *close_errors]
    result.update(
        {
            'open_values': open_values,
            'close_values': close_values,
            'errors': errors,
            'ok': not errors and (bool(open_values) or bool(close_values)),
            'message': 'PLC read OK' if not errors else '; '.join(errors),
        }
    )
    return result


@app.post('/plc-monitor/stop')
def stop_plc_monitor(x_auth_token: str | None = Header(default=None)):
    require_role(x_auth_token, {'superadmin', 'admin'})
    plc_monitor_state['enabled'] = False
    plc_monitor_stop_event.set()
    if plc_monitor_thread and plc_monitor_thread.is_alive():
        plc_monitor_thread.join(timeout=3)
    if recording_state.get('running') and recording_state.get('event_type') in {'minor_stoppage', 'breakdown'}:
        stop_recording_internal()
    plc_monitor_state.update(
        {
            'enabled': False,
            'running': False,
            'gate_open': False,
            'gate_close': False,
            'machine_state': None,
            'machine_state_started_at': None,
            'machine_state_duration_seconds': 0,
            'current_event_type': None,
            'current_event_started_at': None,
            'current_event_duration_seconds': None,
            'last_action': f'Gate trigger disabled at {datetime.now().isoformat(timespec="seconds")}.',
            'last_error': None,
            'open_values': {},
            'close_values': {},
        }
    )
    return plc_monitor_state


@app.get('/reasons')
def reasons(storage_root: str = DEFAULT_STORAGE_ROOT):
    try:
        return list_reason_options(storage_root)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/reasons')
def create_reason(request: ReasonRequest):
    try:
        return add_reason_option(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post('/recording-reason')
def save_recording_reason(request: RecordingReasonRequest):
    try:
        return update_recording_reason(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def default_plc_monitor_request() -> PlcMonitorRequest:
    return settings_to_plc_request(load_helper_settings())


def ensure_auto_plc_monitor_running():
    if not plc_monitor_state.get('enabled', False):
        return
    if plc_monitor_state.get('running') and plc_monitor_thread and plc_monitor_thread.is_alive():
        return
    try:
        start_plc_monitor_internal(default_plc_monitor_request())
    except Exception as exc:
        plc_monitor_state['last_error'] = f'PLC monitor auto-start failed: {exc}'


@app.on_event('startup')
def auto_start_plc_monitor():
    settings = load_helper_settings()
    plc_monitor_state['enabled'] = bool(settings.plc_enabled)
    ensure_shared_camera_worker(settings.ip, settings.rtsp_port, settings.username, settings.password, settings.channel, settings.rtsp_path)
    if settings.plc_enabled:
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


@app.get('/recording-index/export.csv')
def recording_index_export(
    storage_root: str = DEFAULT_STORAGE_ROOT,
    start_at: str | None = None,
    end_at: str | None = None,
    event_type: str | None = None,
    shift: str | None = None,
    duration_filter: str | None = None,
    machine: str | None = None,
    public_helper_url: str | None = None,
):
    try:
        request = RecordingIndexRequest(
            storage_root=storage_root,
            start_at=start_at,
            end_at=end_at,
            event_type=event_type if event_type and event_type != 'all' else None,
            shift=shift if shift and shift != 'all' else None,
            duration_filter=duration_filter,
            machine=machine,
            public_helper_url=public_helper_url,
            page=1,
            page_size=100,
        )
        content = recording_export_csv(request).encode('utf-8-sig')
        filename = f'machine_stoppage_report_{datetime.now():%Y%m%d_%H%M%S}.csv'
        return StreamingResponse(
            iter([content]),
            media_type='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get('/recording-index/export.xlsx')
def recording_index_export_excel(
    storage_root: str = DEFAULT_STORAGE_ROOT,
    start_at: str | None = None,
    end_at: str | None = None,
    event_type: str | None = None,
    shift: str | None = None,
    duration_filter: str | None = None,
    machine: str | None = None,
    public_helper_url: str | None = None,
):
    try:
        request = RecordingIndexRequest(
            storage_root=storage_root,
            start_at=start_at,
            end_at=end_at,
            event_type=event_type if event_type and event_type != 'all' else None,
            shift=shift if shift and shift != 'all' else None,
            duration_filter=duration_filter,
            machine=machine,
            public_helper_url=public_helper_url,
            page=1,
            page_size=100,
        )
        content = recording_export_xlsx(request)
        filename = f'machine_stoppage_report_{datetime.now():%Y%m%d_%H%M%S}.xlsx'
        return StreamingResponse(
            iter([content]),
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'},
        )
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
        http, _, base_url = login_camera(request.ip, request.http_port, request.username, request.password)
        response = http.get(f'{base_url}/cpapi_Loadfile{request.file_path}', timeout=120, verify=False)
        response.raise_for_status()
        return {'content': base64.b64encode(response.content).decode()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _camera_proxy_base() -> str:
    settings = load_helper_settings()
    return camera_base_url(settings.ip, settings.http_port)


def _strip_frame_blocking_headers(headers: dict) -> dict:
    blocked = {
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
        'x-frame-options',
        'content-security-policy',
    }
    return {key: value for key, value in headers.items() if key.lower() not in blocked}


CAMERA_AUTOLOGIN_SCRIPT = r"""
<script>
(function () {
  var user = "admin";
  var password = "Admin@123";
  var key = "rico_camera_autologin_attempted";

  function visible(element) {
    if (!element) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickLogin() {
    if (sessionStorage.getItem(key)) return;
    var inputs = Array.prototype.slice.call(document.querySelectorAll("input"));
    var passwordInput = inputs.find(function (input) {
      return input.type === "password" && visible(input);
    });
    if (!passwordInput) return;

    var userInput = inputs.find(function (input) {
      var type = (input.type || "text").toLowerCase();
      return type !== "password" && visible(input);
    });
    if (userInput) {
      userInput.focus();
      userInput.value = user;
      userInput.dispatchEvent(new Event("input", { bubbles: true }));
      userInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    passwordInput.focus();
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));

    var buttons = Array.prototype.slice.call(document.querySelectorAll("button,input[type=button],input[type=submit]"));
    var loginButton = buttons.find(function (button) {
      return /login/i.test((button.innerText || button.value || "").trim()) && visible(button);
    });
    if (loginButton) {
      sessionStorage.setItem(key, String(Date.now()));
      loginButton.click();
    }
  }

  var timer = window.setInterval(clickLogin, 1000);
  window.setTimeout(function () { window.clearInterval(timer); }, 15000);
})();
</script>
"""


def _inject_camera_autologin(content: bytes, content_type: str | None) -> bytes:
    if not content_type or 'text/html' not in content_type.lower():
        return content
    try:
        html = content.decode('utf-8')
    except UnicodeDecodeError:
        return content
    if 'rico_camera_autologin_attempted' in html:
        return content
    marker = '</body>'
    if marker in html:
        html = html.replace(marker, f'{CAMERA_AUTOLOGIN_SCRIPT}{marker}', 1)
    else:
        html = f'{html}{CAMERA_AUTOLOGIN_SCRIPT}'
    return html.encode('utf-8')


def _proxy_camera_http(path: str, request: Request) -> Response:
    base_url = _camera_proxy_base()
    target_url = f'{base_url}/{path.lstrip("/")}'
    if request.url.query:
        target_url = f'{target_url}?{request.url.query}'
    try:
        body = request._body if hasattr(request, '_body') else None
    except Exception:
        body = None
    try:
        headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower()
            not in {
                'host',
                'content-length',
                'connection',
                'accept-encoding',
                'origin',
                'referer',
            }
        }
        headers['Origin'] = base_url
        headers['Referer'] = f'{base_url}/'
        upstream = requests.request(
            request.method,
            target_url,
            headers=headers,
            data=body,
            timeout=30,
            verify=False,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f'Camera proxy failed: {exc}')
    content_type = upstream.headers.get('content-type')
    content = (
        _inject_camera_autologin(upstream.content, content_type)
        if 200 <= upstream.status_code < 300
        else upstream.content
    )
    return Response(
        content=content,
        status_code=upstream.status_code,
        headers=_strip_frame_blocking_headers(dict(upstream.headers)),
        media_type=content_type,
    )


@app.api_route('/camera-web', methods=['GET', 'POST'])
@app.api_route('/camera-web/{path:path}', methods=['GET', 'POST'])
async def camera_web_proxy(request: Request, path: str = ''):
    body = await request.body()
    request._body = body
    return _proxy_camera_http(path or '/', request)


@app.websocket('/rtspoverwebsocket')
async def camera_rtsp_websocket(websocket: WebSocket):
    await websocket.accept()
    settings = load_helper_settings()
    scheme = 'wss' if int(settings.http_port) == 443 else 'ws'
    target = f'{scheme}://{settings.ip}:{settings.http_port}/rtspoverwebsocket'
    ssl_context = None
    if scheme == 'wss':
        ssl_context = ssl._create_unverified_context()
    try:
        async with websockets.connect(target, ssl=ssl_context, open_timeout=10) as upstream:
            async def client_to_camera():
                while True:
                    message = await websocket.receive()
                    if message.get('type') == 'websocket.disconnect':
                        break
                    if message.get('bytes') is not None:
                        await upstream.send(message['bytes'])
                    elif message.get('text') is not None:
                        await upstream.send(message['text'])

            async def camera_to_client():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            done, pending = await asyncio.wait(
                {asyncio.create_task(client_to_camera()), asyncio.create_task(camera_to_client())},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


@app.api_route('/cpapi2_Login', methods=['GET', 'POST'])
@app.api_route('/cpapi2', methods=['GET', 'POST'])
@app.api_route('/cpapi3', methods=['GET', 'POST'])
@app.api_route('/cpapi_outsidecmd', methods=['GET', 'POST'])
@app.api_route('/cpapi2_Notify_Method', methods=['GET', 'POST'])
@app.api_route('/cpapi/{path:path}', methods=['GET', 'POST'])
@app.api_route('/web_caps/{path:path}', methods=['GET', 'POST'])
@app.api_route('/style/{path:path}', methods=['GET', 'POST'])
@app.api_route('/custom_lang/{path:path}', methods=['GET', 'POST'])
@app.api_route('/default_lang/{path:path}', methods=['GET', 'POST'])
@app.api_route('/static/{path:path}', methods=['GET', 'POST'])
@app.api_route('/register.json', methods=['GET', 'POST'])
@app.api_route('/qrcode.js', methods=['GET'])
@app.api_route('/less.min.js', methods=['GET'])
@app.api_route('/favicon.ico', methods=['GET'])
@app.api_route('/{asset_path:path}', methods=['GET', 'POST'])
async def camera_asset_proxy(request: Request, asset_path: str = ''):
    camera_api_paths = {
        'cpapi2_Login',
        'cpapi2',
        'cpapi3',
        'cpapi_outsidecmd',
        'cpapi2_Notify_Method',
        'qrcode.js',
        'less.min.js',
        'favicon.ico',
        'register.json',
    }
    if asset_path and not (
        asset_path in camera_api_paths
        or
        asset_path.endswith((
            '.js',
            '.css',
            '.less',
            '.txt',
            '.json',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.ico',
            '.wasm',
            '.worker.js',
        ))
        or asset_path.startswith((
            'static/',
            'style/',
            'locales/',
            'custom_lang/',
            'default_lang/',
            'web_caps/',
            'cpapi/',
        ))
    ):
        raise HTTPException(status_code=404, detail='Not found')
    body = await request.body()
    request._body = body
    return _proxy_camera_http(request.url.path, request)


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8010, reload=False, log_config=None)
