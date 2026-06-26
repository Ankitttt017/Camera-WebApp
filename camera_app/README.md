# Machine Event Recorder

Production-floor camera recording system for CP Plus IP cameras. The app uses a FastAPI helper for camera/PLC operations and a React frontend for live monitoring, manual capture, PLC gate-triggered recording, and saved video review.

## Features

- Live MJPEG camera view from RTSP
- Manual start/stop PC recording
- Automatic PLC gate-triggered recording
- Local recording archive with metadata and SQLite index
- React operator console
- FastAPI helper API

## Prerequisites

- Python 3.11+ recommended
- Node.js 20+ recommended
- Access to the camera network
- Access to the PLC network

## Setup

From `camera_app/`, create and activate a Python virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```powershell
pip install -r requirements.txt
```

Install frontend dependencies:

```powershell
cd frontend
npm.cmd install
cd ..
```

Copy `.env.example` to `.env` and update values if needed.

## Run

Start the FastAPI helper:

```powershell
python backend\cpplus_helper.py
```

In another terminal, start the React frontend:

```powershell
cd frontend
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

## Local Testing

1. Start the helper API.
2. Start the React frontend.
3. Open the UI and verify live video, recording status, PLC status, and saved recordings.
4. Useful helper endpoints:
   - `GET /recording/status`
   - `GET /plc-monitor/status`
   - `POST /recording/start`
   - `POST /recording/stop`
   - `POST /recording-index/list`

## Project Structure

`camera_app/`

- `backend/` - FastAPI helper and camera/PLC services
- `frontend/` - React operator console
- `recordings/` - Local generated recordings
- `snapshots/` - Local generated snapshots
- `.env.example` - Example environment variables
- `requirements.txt` - Python dependencies

## Notes

- The helper defaults to `127.0.0.1:8010`.
- The React dev server defaults to `127.0.0.1:5173`.
- If `ffmpeg` is not installed, recording falls back to OpenCV video-only recording.
