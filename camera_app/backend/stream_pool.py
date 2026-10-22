"""
Multi-camera Stream Pool for Dynamic Industrial Live Monitoring.
Provides on-demand OpenCV/RTSP stream workers per camera.
Auto-pauses streams when not viewed to conserve CPU and network bandwidth.
"""
import base64
import logging
import threading
import time
from typing import Dict, Optional, Tuple
import base64
import logging
import os
import threading
import time
import urllib.parse
from typing import Dict, Optional, Tuple
import cv2
import numpy as np

# Force TCP transport for RTSP streams across all industrial cameras
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

logger = logging.getLogger("stream_pool")

class CameraStreamWorker:
    def __init__(self, camera_id: int, ip: str, rtsp_port: int, username: str, password: str, channel: int = 1, rtsp_path: Optional[str] = None):
        self.camera_id = camera_id
        self.ip = ip
        self.rtsp_port = rtsp_port
        self.username = username
        self.password = password
        self.channel = channel
        self.rtsp_path = rtsp_path
        
        self.lock = threading.Lock()
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        
        self.latest_frame: Optional[np.ndarray] = None
        self.latest_jpeg: Optional[bytes] = None
        self.last_frame_time: float = 0.0
        self.last_requested_time: float = time.monotonic()
        self.status = "idle"
        self.error: Optional[str] = None
        self.fps: float = 12.0
        self.width: int = 1280
        self.height: int = 720
        self.active_path: Optional[str] = None

    def get_candidate_urls(self) -> list:
        paths = []
        if self.rtsp_path:
            paths.append(self.rtsp_path)
        paths.extend([
            f"/video/live?channel={self.channel}&subtype=0",
            f"/video/live?channel={self.channel}&subtype=1",
            f"/cam/realmonitor?channel={self.channel}&subtype=0",
            f"/cam/realmonitor?channel={self.channel}&subtype=1",
            f"/Streaming/Channels/{self.channel}01",
            f"/Streaming/Channels/{self.channel}02",
        ])
        
        # Deduplicate preserving order
        clean_paths = []
        for p in paths:
            if not p.startswith("/"):
                p = "/" + p
            if p not in clean_paths:
                clean_paths.append(p)

        urls = []
        for p in clean_paths:
            if self.username and self.password:
                # Raw and quoted credentials
                urls.append(f"rtsp://{self.username}:{self.password}@{self.ip}:{self.rtsp_port}{p}")
                quoted_user = urllib.parse.quote(self.username)
                quoted_pass = urllib.parse.quote(self.password)
                if quoted_pass != self.password:
                    urls.append(f"rtsp://{quoted_user}:{quoted_pass}@{self.ip}:{self.rtsp_port}{p}")
            else:
                urls.append(f"rtsp://{self.ip}:{self.rtsp_port}{p}")
        return urls

    def touch(self):
        self.last_requested_time = time.monotonic()
        if not self.running:
            self.start()

    def start(self):
        if self.running and self.thread and self.thread.is_alive():
            return
        self.running = True
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._worker_loop, daemon=True, name=f"StreamWorker-{self.camera_id}")
        self.thread.start()

    def stop(self):
        self.running = False
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        self.status = "stopped"

    def _worker_loop(self):
        self.status = "connecting"
        capture = None
        reconnect_delay = 2.0
        
        while self.running and not self.stop_event.is_set():
            # Check idle timeout: if no client requested frames for 45s, pause stream to save CPU
            if time.monotonic() - self.last_requested_time > 45.0:
                self.status = "paused"
                break
                
            if capture is None or not capture.isOpened():
                self.status = "connecting"
                candidate_urls = self.get_candidate_urls()
                connected = False
                
                for url in candidate_urls:
                    if not self.running or self.stop_event.is_set():
                        break
                    try:
                        cap = cv2.VideoCapture()
                        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 2500)
                        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 2500)
                        cap.open(url, cv2.CAP_FFMPEG)
                        if cap.isOpened():
                            ret, frame = cap.read()
                            if ret and frame is not None:
                                capture = cap
                                connected = True
                                self.status = "connected"
                                self.error = None
                                break
                            cap.release()
                    except Exception:
                        pass
                
                if not connected:
                    self.error = f"Cannot open RTSP at {self.ip}:{self.rtsp_port} (Auth / Path failed)"
                    self.status = "error"
                    # Exponential backoff: rapid failed logins make CP Plus cameras lock the account.
                    self.stop_event.wait(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, 60.0)
                    continue
                reconnect_delay = 2.0

            ok, frame = capture.read()
            if not ok or frame is None:
                self.error = "Frame read dropped"
                self.status = "reconnecting"
                if capture:
                    capture.release()
                    capture = None
                time.sleep(1.0)
                continue

            now = time.monotonic()
            h, w = frame.shape[:2]
            
            # High quality JPEG encoding (85%) for crystal-clear industrial clarity
            encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 85]
            ret, jpeg = cv2.imencode('.jpg', frame, encode_param)
            
            with self.lock:
                self.latest_frame = frame
                self.latest_jpeg = jpeg.tobytes() if ret else None
                self.last_frame_time = now
                self.width = w
                self.height = h
                self.status = "streaming"
                self.error = None

            # Control capture rate (~15-20 fps)
            time.sleep(0.04)

        if capture:
            capture.release()
        self.running = False


class CameraStreamPool:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(CameraStreamPool, cls).__new__(cls)
                cls._instance.workers: Dict[int, CameraStreamWorker] = {}
                cls._instance.pool_lock = threading.Lock()
            return cls._instance

    def get_worker(self, camera_id: int, ip: str, rtsp_port: int, username: str, password: str, channel: int = 1, rtsp_path: Optional[str] = None) -> CameraStreamWorker:
        with self.pool_lock:
            worker = self.workers.get(camera_id)
            if worker is None:
                worker = CameraStreamWorker(camera_id, ip, rtsp_port, username, password, channel, rtsp_path)
                self.workers[camera_id] = worker
            else:
                # Update settings if changed
                worker.ip = ip
                worker.rtsp_port = rtsp_port
                worker.username = username
                worker.password = password
                worker.channel = channel
                worker.rtsp_path = rtsp_path
            worker.touch()
            return worker

    def get_latest_jpeg(self, camera_id: int) -> Tuple[Optional[bytes], str, Optional[str]]:
        with self.pool_lock:
            worker = self.workers.get(camera_id)
        if not worker:
            return None, "offline", "Camera worker not initialized"
        worker.touch()
        with worker.lock:
            return worker.latest_jpeg, worker.status, worker.error

    def remove_worker(self, camera_id: int):
        with self.pool_lock:
            worker = self.workers.pop(camera_id, None)
            if worker:
                worker.stop()

stream_pool = CameraStreamPool()
