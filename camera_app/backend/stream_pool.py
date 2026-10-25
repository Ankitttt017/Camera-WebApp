"""
Multi-camera Stream Pool for Dynamic Industrial Live Monitoring.
Provides on-demand OpenCV/RTSP stream workers per camera.
Auto-pauses streams when not viewed to conserve CPU and network bandwidth.
"""
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

# A worker that stops producing frames (RTSP read hung, thread died) is replaced by a new one.
STALL_SECONDS = float(os.getenv("LIVE_STREAM_STALL_SECONDS", "10"))
# Connecting tries several RTSP paths with a 2.5 s timeout each; give it this long before replacing.
CONNECT_GRACE_SECONDS = 60.0
MIN_RESTART_INTERVAL = 15.0   # CP Plus locks the account after rapid failed logins

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
        self.generation = 0
        self.started_at = 0.0
        self.last_restart_at = 0.0

    def get_candidate_urls(self) -> list:
        paths = []
        if self.active_path:
            paths.append(self.active_path)
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
        alive = self.thread is not None and self.thread.is_alive()
        if not self.running or not alive:
            self.start()
        elif self._stalled():
            self.restart("no frames for %.0fs" % (time.monotonic() - max(self.last_frame_time, self.started_at)))

    def _stalled(self) -> bool:
        now = time.monotonic()
        if now - self.last_restart_at < MIN_RESTART_INTERVAL:
            return False
        if self.status in ("connecting", "error"):
            # still trying (or backing off) inside the loop; only a hung connect counts
            return self.status == "connecting" and now - max(self.last_frame_time, self.started_at) > CONNECT_GRACE_SECONDS
        return now - max(self.last_frame_time, self.started_at) > STALL_SECONDS

    def start(self):
        if self.running and self.thread and self.thread.is_alive():
            return
        self._spawn()

    def restart(self, reason: str):
        logger.warning("camera %s: restarting stream worker (%s)", self.camera_id, reason)
        self._spawn()

    def _spawn(self):
        # A new generation; an old thread stuck in a blocking RTSP read exits once the read returns.
        self.generation += 1
        self.running = True
        self.stop_event.clear()
        self.started_at = self.last_restart_at = time.monotonic()
        self.thread = threading.Thread(target=self._worker_loop, args=(self.generation,), daemon=True,
                                       name=f"StreamWorker-{self.camera_id}-{self.generation}")
        self.thread.start()

    def stop(self):
        self.running = False
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        self.status = "stopped"

    def _worker_loop(self, generation: int):
        capture = None
        reconnect_delay = 2.0

        def current() -> bool:
            return self.running and not self.stop_event.is_set() and generation == self.generation

        try:
            while current():
                # No client requested frames for 45 s: pause the stream to save CPU and bandwidth.
                if time.monotonic() - self.last_requested_time > 45.0:
                    self.status = "paused"
                    break
                try:
                    if capture is None or not capture.isOpened():
                        self.status = "connecting"
                        capture = self._open_capture(current)
                        if capture is None:
                            if not current():
                                break
                            self.error = f"Cannot open RTSP at {self.ip}:{self.rtsp_port} (Auth / Path failed)"
                            self.status = "error"
                            # Exponential backoff: rapid failed logins make CP Plus cameras lock the account.
                            self.stop_event.wait(reconnect_delay)
                            reconnect_delay = min(reconnect_delay * 2, 60.0)
                            continue
                        reconnect_delay = 2.0

                    ok, frame = capture.read()
                    if not current():
                        break
                    if not ok or frame is None:
                        self.error = "Frame read dropped"
                        self.status = "reconnecting"
                        capture.release()
                        capture = None
                        time.sleep(1.0)
                        continue

                    h, w = frame.shape[:2]
                    # High quality JPEG encoding (85%) for crystal-clear industrial clarity
                    ret, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                    with self.lock:
                        self.latest_frame = frame
                        self.latest_jpeg = jpeg.tobytes() if ret else self.latest_jpeg
                        self.last_frame_time = time.monotonic()
                        self.width = w
                        self.height = h
                        self.status = "streaming"
                        self.error = None

                    # Control capture rate (~15-20 fps)
                    time.sleep(0.04)
                except Exception as exc:  # never let the thread die silently
                    logger.exception("camera %s: stream worker error", self.camera_id)
                    self.error = str(exc)
                    self.status = "reconnecting"
                    if capture is not None:
                        try:
                            capture.release()
                        except Exception:
                            pass
                        capture = None
                    time.sleep(2.0)
        finally:
            if capture is not None:
                try:
                    capture.release()
                except Exception:
                    pass
            if generation == self.generation:
                self.running = False

    def _open_capture(self, current):
        for url in self.get_candidate_urls():
            if not current():
                return None
            cap = None
            try:
                cap = cv2.VideoCapture()
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 2500)
                cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 2500)
                cap.open(url, cv2.CAP_FFMPEG)
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        self.active_path = '/' + url.split('/', 3)[3] if url.count('/') >= 3 else None
                        self.status = "connected"
                        self.error = None
                        return cap
                cap.release()
            except Exception:
                if cap is not None:
                    cap.release()
        return None


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

    def get_frame(self, camera_id: int) -> Tuple[Optional[bytes], float, str]:
        """Latest JPEG, its capture time (time.monotonic) and worker status; touching keeps it alive."""
        with self.pool_lock:
            worker = self.workers.get(camera_id)
        if not worker:
            return None, 0.0, "offline"
        worker.touch()
        with worker.lock:
            return worker.latest_jpeg, worker.last_frame_time, worker.status

    def remove_worker(self, camera_id: int):
        with self.pool_lock:
            worker = self.workers.pop(camera_id, None)
            if worker:
                worker.stop()

_PLACEHOLDERS: Dict[str, bytes] = {}


def placeholder_jpeg(text: str = "Camera reconnecting...") -> bytes:
    """Small dark frame with a status line, sent while a camera has no fresh picture."""
    if text not in _PLACEHOLDERS:
        img = np.full((360, 640, 3), 24, dtype=np.uint8)
        size, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2)
        cv2.putText(img, text, ((640 - size[0]) // 2, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2, cv2.LINE_AA)
        _PLACEHOLDERS[text] = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])[1].tobytes()
    return _PLACEHOLDERS[text]


stream_pool = CameraStreamPool()
