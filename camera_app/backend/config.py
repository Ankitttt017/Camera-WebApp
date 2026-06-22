import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

CAMERA_IPS = [
    ip.strip()
    for ip in os.getenv('CAMERA_IPS', os.getenv('CAMERA_IP', '192.168.119.205')).split(',')
    if ip.strip()
]
CAMERA_IP = CAMERA_IPS[0] if CAMERA_IPS else '127.0.0.1'
CAMERA_USER = os.getenv('CAMERA_USER', 'admin')
CAMERA_PASSWORD = os.getenv('CAMERA_PASSWORD', 'Admin@123')
RTSP_PORTS = [int(p) for p in os.getenv('RTSP_PORTS', '554,25001,8000,8899').split(',') if p]
HTTP_PORTS = [int(p) for p in os.getenv('HTTP_PORTS', '80,8080').split(',') if p]
ONVIF_PORTS = [int(p) for p in os.getenv('ONVIF_PORTS', '80,8080').split(',') if p]
DATABASE_URL = os.getenv(
    'DATABASE_URL',
    f"sqlite:///{(BASE_DIR / 'camera_app.db').as_posix()}"
)
RECORDINGS_ROOT = Path(os.getenv('RECORDINGS_ROOT', BASE_DIR / 'recordings'))
SNAPSHOTS_ROOT = Path(os.getenv('SNAPSHOTS_ROOT', BASE_DIR / 'snapshots'))
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
MAX_RECONNECT_ATTEMPTS = int(os.getenv('MAX_RECONNECT_ATTEMPTS', '5'))
RECONNECT_INTERVAL = int(os.getenv('RECONNECT_INTERVAL', '10'))
FRAME_WIDTH = int(os.getenv('FRAME_WIDTH', '1280'))
FRAME_HEIGHT = int(os.getenv('FRAME_HEIGHT', '720'))

engine = create_engine(DATABASE_URL, future=True, connect_args={'check_same_thread': False} if 'sqlite' in DATABASE_URL else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

RECORDINGS_ROOT.mkdir(parents=True, exist_ok=True)
SNAPSHOTS_ROOT.mkdir(parents=True, exist_ok=True)
