"""Speech-only gate for live camera audio.

Factory noise (hydraulics, fans, die-casting shots) is as loud as the operator's voice, so a
level-based gate (ffmpeg agate) cannot separate them. This gate uses the Silero VAD model that
ships with faster-whisper to detect *speech*, passes the audio while someone is talking and
attenuates everything else.

Streaming, 16 kHz mono float32. Adds LOOKAHEAD_MS of latency so the start of a word is not cut.
"""
from __future__ import annotations

import numpy as np

SAMPLE_RATE = 16000
FRAME = 512          # Silero VAD frame (32 ms at 16 kHz)
CONTEXT = 64         # samples of left context the model expects


def load_vad_session():
    """Return the onnxruntime session of faster-whisper's Silero VAD, or None if unavailable."""
    try:
        from faster_whisper.vad import get_vad_model
        return get_vad_model().session
    except Exception:
        return None


class SpeechGate:
    def __init__(
        self,
        session,
        open_threshold: float = 0.5,
        close_threshold: float = 0.35,
        hangover_ms: int = 500,
        lookahead_ms: int = 200,
        floor_db: float = -26.0,
        ramp_ms: int = 20,
    ):
        self.session = session
        self.open_threshold = open_threshold
        self.close_threshold = close_threshold
        self.hangover_frames = max(1, int(hangover_ms / 32))
        self.lookahead_frames = max(0, int(lookahead_ms / 32))
        self.floor = float(10 ** (floor_db / 20))
        self.ramp_step = 1.0 / max(1, int(SAMPLE_RATE * ramp_ms / 1000))
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(CONTEXT, dtype=np.float32)
        self._pending = np.zeros(0, dtype=np.float32)
        self._delay: list[np.ndarray] = []     # frames waiting for lookahead
        self._speech: list[bool] = []          # speech decision per delayed frame
        self._active = False
        self._quiet_frames = 0
        self._gain = self.floor

    def _speech_prob(self, frame: np.ndarray) -> float:
        x = np.concatenate([self._context, frame])[None, :].astype(np.float32)
        out, self._h, self._c = self.session.run(None, {'input': x, 'h': self._h, 'c': self._c})
        self._context = frame[-CONTEXT:]
        return float(np.asarray(out).reshape(-1)[0])

    def _decide(self, prob: float) -> bool:
        if prob >= self.open_threshold:
            self._active = True
            self._quiet_frames = 0
        elif self._active:
            if prob < self.close_threshold:
                self._quiet_frames += 1
                if self._quiet_frames > self.hangover_frames:
                    self._active = False
            else:
                self._quiet_frames = 0
        return self._active

    def _apply_gain(self, frame: np.ndarray, open_: bool) -> np.ndarray:
        target = 1.0 if open_ else self.floor
        gains = np.empty(len(frame), dtype=np.float32)
        g = self._gain
        for i in range(len(frame)):
            if g < target:
                g = min(target, g + self.ramp_step)
            elif g > target:
                g = max(target, g - self.ramp_step)
            gains[i] = g
        self._gain = g
        return frame * gains

    def process(self, audio: np.ndarray) -> np.ndarray:
        """Feed any number of samples; returns the gated samples that are ready (delayed by the lookahead)."""
        buf = np.concatenate([self._pending, audio.astype(np.float32, copy=False)])
        n = len(buf) // FRAME
        self._pending = buf[n * FRAME:]
        out = []
        for i in range(n):
            frame = buf[i * FRAME:(i + 1) * FRAME]
            speech = self._decide(self._speech_prob(frame))
            self._delay.append(frame)
            self._speech.append(speech)
            if speech:
                # lookahead: open the gate for the frames still waiting in the delay line
                self._speech = [True] * len(self._speech)
            if len(self._delay) > self.lookahead_frames:
                out.append(self._apply_gain(self._delay.pop(0), self._speech.pop(0)))
        return np.concatenate(out) if out else np.zeros(0, dtype=np.float32)
