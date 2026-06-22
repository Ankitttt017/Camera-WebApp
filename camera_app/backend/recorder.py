import cv2
from datetime import datetime
from pathlib import Path

from . import config


def get_recording_path() -> Path:
    now = datetime.utcnow()
    path = config.RECORDINGS_ROOT / f'{now:%Y}' / f'{now:%m}' / f'{now:%d}'
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_recording_frame(frame, prefix: str = 'recording') -> Path:
    path = get_recording_path() / f'{prefix}_{datetime.utcnow():%H%M%S%f}.jpg'
    cv2.imwrite(str(path), frame)
    return path


def write_video(frames, filename: str = None, fps: float = 15.0, width: int = 1280, height: int = 720) -> Path:
    if filename is None:
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f'recording_{timestamp}.mp4'
    output_path = get_recording_path() / filename
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
    for frame in frames:
        writer.write(frame)
    writer.release()
    return output_path
