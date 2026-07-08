import asyncio
import base64
import socket
import typing

import requests
from onvif import ONVIFCamera
from requests.auth import HTTPDigestAuth
from . import config
from .models import EventLog
from sqlalchemy.orm import Session

DEFAULT_RTSP_PATHS = [
    'h264',
    'stream1',
    'mpeg4',
    'live.sdp',
    'ch0_0.264',
    'ch0_0.h264',
]


def ping_camera_sync(ip: str, timeout: float = 2.0) -> bool:
    import platform
    import subprocess

    command = ['ping']
    if platform.system().lower() == 'windows':
        command += ['-n', '1', '-w', str(int(timeout * 1000)), ip]
    else:
        command += ['-c', '1', '-W', str(int(timeout)), ip]

    try:
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def scan_ports(ip: str, ports: typing.List[int], timeout: float = 1.0) -> typing.List[int]:
    open_ports = []
    for port in ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                if sock.connect_ex((ip, port)) == 0:
                    open_ports.append(port)
        except OSError:
            continue
    return open_ports


def _build_rtsp_urls(ip: str, user: str, password: str, ports: typing.List[int]) -> typing.List[str]:
    urls = []
    for port in ports:
        for path in DEFAULT_RTSP_PATHS:
            urls.append(f'rtsp://{user}:{password}@{ip}:{port}/{path}')
            urls.append(f'rtsp://{user}:{password}@{ip}:{port}/camera/{path}')
            urls.append(f'rtsp://{user}:{password}@{ip}:{port}/Streaming/Channels/101')
            urls.append(f'rtsp://{user}:{password}@{ip}:{port}/streaming/channels/1')
    return urls


def detect_rtsp(ip: str, user: str, password: str, ports: typing.List[int]) -> typing.Optional[str]:
    import cv2

    for url in _build_rtsp_urls(ip, user, password, ports):
        capture = cv2.VideoCapture(url)
        if capture.isOpened():
            capture.release()
            return url
        capture.release()
    return None


def fetch_http_info(ip: str, ports: typing.List[int], user: str, password: str) -> typing.Dict[str, typing.Optional[str]]:
    for port in ports:
        base_url = f'http://{ip}:{port}'
        paths = ['/', '/ISAPI/System/deviceInfo', '/ISAPI/System/Video/inputs', '/onvif/device_service']
        for path in paths:
            try:
                response = requests.get(base_url + path, auth=HTTPDigestAuth(user, password), timeout=3)
                if response.status_code in (200, 401, 403):
                    return {
                        'base_url': base_url,
                        'path': path,
                        'status_code': response.status_code,
                        'text': response.text[:1000],
                    }
            except requests.RequestException:
                continue
    return {}


def discover_onvif(ip: str, ports: typing.List[int], user: str, password: str) -> typing.Dict[str, typing.List[str]]:
    profiles = []
    services = []
    for port in ports:
        try:
            cam = ONVIFCamera(ip, port, user, password, wsdl_dir=None)
            media = cam.create_media_service()
            profile_list = media.GetProfiles()
            profiles.extend([p.Name for p in profile_list])
            services.append(f'{ip}:{port}')
            break
        except Exception:
            continue
    return {'services': services, 'profiles': profiles}


def log_event(db: Session, category: str, message: str, details: str = '') -> None:
    event = EventLog(category=category, message=message, details=details)
    db.add(event)
    db.commit()

def build_protocol_report(ip: str, db: Session) -> typing.Dict[str, object]:
    report = {
        'ping': False,
        'open_ports': [],
        'rtsp_url': None,
        'http_info': None,
        'onvif_info': None,
        'errors': [],
    }
    try:
        report['ping'] = ping_camera_sync(ip)
    except Exception as exc:
        report['errors'].append(f'Ping failed: {exc}')
        log_event(db, 'connection', 'Ping failed', str(exc))

    report['open_ports'] = scan_ports(ip, list(set(config.RTSP_PORTS + config.HTTP_PORTS + config.ONVIF_PORTS)))
    if report['open_ports']:
        log_event(db, 'connection', 'Open ports detected', str(report['open_ports']))
    else:
        log_event(db, 'connection', 'No open ports detected', '')

    if any(port in report['open_ports'] for port in config.RTSP_PORTS):
        try:
            rtsp_url = detect_rtsp(ip, config.CAMERA_USER, config.CAMERA_PASSWORD, [p for p in report['open_ports'] if p in config.RTSP_PORTS])
            report['rtsp_url'] = rtsp_url
            if rtsp_url:
                log_event(db, 'protocol', 'RTSP detected', rtsp_url)
        except Exception as exc:
            report['errors'].append(f'RTSP detection failed: {exc}')
            log_event(db, 'error', 'RTSP detection failed', str(exc))

    if any(port in report['open_ports'] for port in config.HTTP_PORTS):
        try:
            report['http_info'] = fetch_http_info(ip, [p for p in report['open_ports'] if p in config.HTTP_PORTS], config.CAMERA_USER, config.CAMERA_PASSWORD)
            if report['http_info']:
                log_event(db, 'protocol', 'HTTP available', str(report['http_info'].get('base_url')))
        except Exception as exc:
            report['errors'].append(f'HTTP discovery failed: {exc}')
            log_event(db, 'error', 'HTTP discovery failed', str(exc))

    if any(port in report['open_ports'] for port in config.ONVIF_PORTS):
        try:
            report['onvif_info'] = discover_onvif(ip, [p for p in report['open_ports'] if p in config.ONVIF_PORTS], config.CAMERA_USER, config.CAMERA_PASSWORD)
            if report['onvif_info'] and report['onvif_info']['profiles']:
                log_event(db, 'protocol', 'ONVIF discovered', str(report['onvif_info']['profiles']))
        except Exception as exc:
            report['errors'].append(f'ONVIF discovery failed: {exc}')
            log_event(db, 'error', 'ONVIF discovery failed', str(exc))

    return report
