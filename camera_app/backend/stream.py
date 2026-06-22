import asyncio
import base64
import threading
import time
from collections import deque
from datetime import datetime
from typing import Dict, Optional

import cv2
from . import config
from .camera_service import detect_rtsp

class CameraStream:
    def __init__(self):
        self.rtsp_url = None
        self.capture = None
        self.frame = None
        self.lock = threading.Lock()
        self.running = False
        self.stats = {'fps': 0.0, 'width': 0, 'height': 0, 'last_frame_time': None}
        self.error = None
        self.reconnect_attempts = 0
        self._thread = None
        self.frame_buffer = deque(maxlen=1)

    def set_rtsp_url(self, rtsp_url: str) -> None:
        self.rtsp_url = rtsp_url

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self.capture is not None:
            self.capture.release()
            self.capture = None

    def _open_capture(self) -> bool:
        if not self.rtsp_url:
            self.error = 'RTSP URL not configured'
            return False
        capture = cv2.VideoCapture(self.rtsp_url)
        if not capture.isOpened():
            self.error = f'Unable to open RTSP stream: {self.rtsp_url}'
            capture.release()
            return False
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
        self.capture = capture
        return True

    def _run(self) -> None:
        while self.running:
            if self.capture is None:
                opened = self._open_capture()
                if not opened:
                    self.reconnect_attempts += 1
                    if self.reconnect_attempts > config.MAX_RECONNECT_ATTEMPTS:
                        self.running = False
                        break
                    time.sleep(config.RECONNECT_INTERVAL)
                    continue
                self.reconnect_attempts = 0

            ret, frame = self.capture.read()
            if not ret or frame is None:
                self.error = 'Frame read failure'
                self.capture.release()
                self.capture = None
                continue

            with self.lock:
                self.frame = frame
                self.stats['width'] = int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH))
                self.stats['height'] = int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
                now = datetime.utcnow()
                last = self.stats['last_frame_time']
                if last:
                    dt = (now - last).total_seconds()
                    self.stats['fps'] = 1.0 / dt if dt > 0 else self.stats['fps']
                self.stats['last_frame_time'] = now
                self.frame_buffer.append(frame)
            time.sleep(0.01)

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def get_stats(self) -> Dict[str, Optional[object]]:
        with self.lock:
            return {
                'fps': round(self.stats['fps'], 2),
                'width': self.stats['width'],
                'height': self.stats['height'],
                'error': self.error,
            }

    def get_latest_jpeg(self) -> Optional[bytes]:
        frame = self.get_frame()
        if frame is None:
            return None
        ret, jpeg = cv2.imencode('.jpg', frame)
        if not ret:
            return None
        return jpeg.tobytes()

    def get_latest_base64(self) -> Optional[str]:
        jpeg = self.get_latest_jpeg()
        return base64.b64encode(jpeg).decode('utf-8') if jpeg else None

    async def websocket_frame_generator(self):
        while self.running:
            data = self.get_latest_base64()
            if data:
                yield data
            await asyncio.sleep(0.05)

    def update_rtsp_from_detected(self) -> None:
        if not self.rtsp_url:
            self.rtsp_url = detect_rtsp(config.CAMERA_IP, config.CAMERA_USER, config.CAMERA_PASSWORD, config.RTSP_PORTS)
