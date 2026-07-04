import cv2
import numpy as np
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional

class MotionDetector:
    def __init__(self, history: int = 30, sensitivity: int = 5000):
        self.history = history
        self.sensitivity = sensitivity
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=history, varThreshold=16, detectShadows=True)
        self.event_log: deque = deque(maxlen=100)

    def analyze_frame(self, frame) -> Dict[str, Optional[object]]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (21, 21), 0)
        mask = self.bg_subtractor.apply(blur)
        _, thresh = cv2.threshold(mask, 244, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        motion_detected = False
        motion_areas: List[tuple] = []
        for contour in contours:
            if cv2.contourArea(contour) < self.sensitivity:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            motion_areas.append((x, y, w, h))
            motion_detected = True

        if motion_detected:

            
            event = {
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'type': 'motion',
                'areas': motion_areas,
            }
            self.event_log.appendleft(event)

        return {
            'motion_detected': motion_detected,
            'motion_areas': motion_areas,
            'events': list(self.event_log),
        }

    def reset(self) -> None:
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=self.history, varThreshold=16, detectShadows=True)
        self.event_log.clear()
