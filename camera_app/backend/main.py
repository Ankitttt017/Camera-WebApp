import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from . import config
from .camera_service import build_protocol_report, discover_onvif, fetch_http_info, log_event
from .models import Base, CameraStatus, EventLog
from .recorder import save_recording_frame
from .detector import MotionDetector
from .stream import CameraStream

app = FastAPI(title='CP Plus Camera Integration', version='1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

status_cache: Dict[str, Optional[object]] = {
    'connected': False,
    'protocol': None,
    'last_error': None,
    'last_update': None,
    'camera': config.CAMERA_IP,
}

camera_stream = CameraStream()
motion_detector = MotionDetector()


@app.on_event('startup')
async def startup_event():
    Base.metadata.create_all(bind=config.engine)
    loop = asyncio.get_event_loop()
    loop.create_task(connection_health_check())


async def connection_health_check():
    while True:
        try:
            with config.SessionLocal() as session:
                report = build_protocol_report(config.CAMERA_IP, session)
                status_cache['connected'] = bool(report['rtsp_url'])
                status_cache['protocol'] = 'RTSP' if report['rtsp_url'] else ('ONVIF' if report['onvif_info'] else ('HTTP' if report['http_info'] else None))
                status_cache['last_error'] = '; '.join(report['errors']) if report['errors'] else None
                status_cache['last_update'] = datetime.utcnow().isoformat() + 'Z'
                if report['rtsp_url']:
                    camera_stream.set_rtsp_url(report['rtsp_url'])
                    if not camera_stream.running:
                        camera_stream.start()
        except Exception as exc:
            status_cache['connected'] = False
            status_cache['last_error'] = str(exc)
        await asyncio.sleep(config.RECONNECT_INTERVAL)


@app.get('/scan')
async def scan() -> JSONResponse:
    with config.SessionLocal() as session:
        report = build_protocol_report(config.CAMERA_IP, session)
        return JSONResponse(report)


@app.get('/status')
async def status() -> JSONResponse:
    stats = camera_stream.get_stats()
    return JSONResponse({**status_cache, **stats})


@app.get('/device_info')
async def device_info() -> JSONResponse:
    try:
        info = fetch_http_info(config.CAMERA_IP, config.HTTP_PORTS, config.CAMERA_USER, config.CAMERA_PASSWORD)
        return JSONResponse(info)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get('/profiles')
async def profiles() -> JSONResponse:
    try:
        info = discover_onvif(config.CAMERA_IP, config.ONVIF_PORTS, config.CAMERA_USER, config.CAMERA_PASSWORD)
        return JSONResponse(info)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get('/snapshot')
async def snapshot() -> JSONResponse:
    frame = camera_stream.get_frame()
    if frame is None:
        raise HTTPException(status_code=404, detail='No frame available')
    path = save_recording_frame(frame, prefix='snapshot')
    return JSONResponse({'snapshot_path': str(path), 'timestamp': datetime.utcnow().isoformat() + 'Z'})


@app.get('/events')
async def events() -> JSONResponse:
    return JSONResponse({'events': motion_detector.event_log})


@app.get('/analytics')
async def analytics() -> JSONResponse:
    frame = camera_stream.get_frame()
    if frame is None:
        raise HTTPException(status_code=404, detail='No frame available for analytics')
    analysis = motion_detector.analyze_frame(frame)
    return JSONResponse(analysis)


@app.get('/frame')
async def frame() -> JSONResponse:
    data = camera_stream.get_latest_base64()
    if not data:
        raise HTTPException(status_code=404, detail='No frame available')
    return JSONResponse({'frame': data})


def _list_files(root_path: str, extensions=None):
    root = Path(root_path)
    if not root.exists():
        return []
    files = []
    for entry in sorted(root.rglob('*')):
        if entry.is_file():
            if extensions and entry.suffix.lower() not in extensions:
                continue
            files.append(str(entry.relative_to(root)).replace('\\', '/'))
    return files


@app.get('/recordings')
async def recordings() -> JSONResponse:
    files = _list_files(str(config.RECORDINGS_ROOT), extensions={'.mp4', '.avi', '.mov', '.mkv'})
    return JSONResponse({'recordings': files})


@app.get('/recordings/{filename:path}')
async def serve_recording(filename: str):
    requested = config.RECORDINGS_ROOT / Path(filename)
    if not requested.exists() or not requested.is_file() or config.RECORDINGS_ROOT not in requested.resolve().parents and requested.resolve() != config.RECORDINGS_ROOT.resolve():
        raise HTTPException(status_code=404, detail='Recording not found')
    return FileResponse(requested, media_type='video/mp4')


@app.get('/snapshots')
async def snapshots() -> JSONResponse:
    files = _list_files(str(config.SNAPSHOTS_ROOT), extensions={'.jpg', '.jpeg', '.png'})
    return JSONResponse({'snapshots': files})


@app.get('/snapshots/{filename:path}')
async def serve_snapshot(filename: str):
    requested = config.SNAPSHOTS_ROOT / Path(filename)
    if not requested.exists() or not requested.is_file() or config.SNAPSHOTS_ROOT not in requested.resolve().parents and requested.resolve() != config.SNAPSHOTS_ROOT.resolve():
        raise HTTPException(status_code=404, detail='Snapshot not found')
    return FileResponse(requested, media_type='image/jpeg')


if __name__ == '__main__':
    uvicorn.run('backend.main:app', host='0.0.0.0', port=8000, reload=True)
