import base64
import hashlib
import json
import secrets
import threading
import time
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import quote

import cv2
import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


app = FastAPI(title='CP Plus Camera Helper')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


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
    storage_root: str = r'C:\CPPLUS_RECORDINGS'


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
}
recording_stop_event = threading.Event()
recording_thread: threading.Thread | None = None


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
    return [
        f'rtsp://{safe_user}:{safe_password}@{host}/video/live?channel={channel_no}&subtype=0&proto=Private3',
        f'rtsp://{safe_user}:{safe_password}@{host}/video/live?channel={channel_no}&subtype=1&proto=Private3',
        f'rtsp://{safe_user}:{safe_password}@{host}/cam/realmonitor?channel={channel_no}&subtype=0',
        f'rtsp://{safe_user}:{safe_password}@{host}/cam/realmonitor?channel={channel_no}&subtype=1',
        f'rtsp://{safe_user}:{safe_password}@{host}/Streaming/Channels/{channel_no}01',
        f'rtsp://{safe_user}:{safe_password}@{host}/streaming/channels/{channel_no}01',
        f'rtsp://{safe_user}:{safe_password}@{host}/h264',
        f'rtsp://{safe_user}:{safe_password}@{host}/ch0_0.h264',
    ]


def snapshot_urls(ip: str, port: int, channel_no: int) -> list[str]:
    base = camera_base_url(ip, port)
    return [
        f'{base}/cgi-bin/snapshot.cgi?channel={channel_no}',
        f'{base}/cgi-bin/snapshot.cgi?channel={channel_no - 1}',
        f'{base}/snapshot.jpg',
        f'{base}/ISAPI/Streaming/channels/{channel_no}01/picture',
    ]


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


def mjpeg_frames(ip: str, rtsp_port: int, username: str, password: str, channel: int):
    capture = None
    last_error = None
    try:
        for url in rtsp_urls(ip, rtsp_port, username, password, channel):
            capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if capture.isOpened():
                break
            last_error = f'open failed: {hide_secret(url, password)}'
            capture.release()
            capture = None

        if capture is None or not capture.isOpened():
            raise RuntimeError(last_error or 'RTSP stream open nahi hua.')

        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                time.sleep(0.05)
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


def record_camera_worker(request: RecordingRequest):
    global recording_state
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
            capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
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
            }
        )

        writer.write(first_frame)
        recording_state['frames'] = 1

        while not recording_stop_event.is_set():
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
            recording_state['path'] = str(target_path)
            recording_state['metadata_path'] = str(sidecar_path)
        recording_state['ended_at'] = ended_at.isoformat(timespec='seconds')
        recording_state['duration_seconds'] = round(duration_seconds, 2)
        recording_state['running'] = False


@app.post('/verify')
def verify(request: CameraRequest):
    try:
        login(camera_base_url(request.ip, request.http_port), request.username, request.password)
        return {'ok': True}
    except Exception as exc:
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
    uvicorn.run('backend.cpplus_helper:app', host='127.0.0.1', port=8010, reload=False)
