import sys
from pathlib import Path

# Add camera_app to sys.path so we can import from backend
sys.path.append(str(Path(__file__).resolve().parents[1]))

from backend.cpplus_helper import transcribe_recording_worker

storage_root = "C:/CPPLUS_RECORDINGS"
video_path = "C:/CPPLUS_RECORDINGS/2026/08/18/192-168-119-205_ch01/cpplus_ch01_20260818_144120_to_144142.mp4"

print("Starting manual transcription with updated prompt configuration...")
transcribe_recording_worker(storage_root, video_path)
print("Reprocessing completed successfully.")
