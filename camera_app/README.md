# CP Plus Camera Integration

A reusable camera integration system for CP Plus IP cameras with automatic protocol detection, RTSP streaming, ONVIF discovery, HTTP device info, recording, motion analytics, and Streamlit dashboard.

## Features

- Automatic protocol detection: RTSP, ONVIF, HTTP
- Port scanning and connection status
- Live video feed with FPS, resolution, and snapshot support
- Local recordings and snapshot archive
- Motion detection and event logging
- FastAPI backend and Streamlit frontend
- Secure credentials with `.env`

## Prerequisites

- Python 3.11+ recommended
- Access to the camera network

## Setup

1. Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and update values if needed.

## Run

Backend:

```powershell
uvicorn backend.main:app --reload
```

Frontend:

```powershell
streamlit run frontend/app.py
```

## Local Testing

1. Start the backend.
2. Start the frontend.
3. Open Streamlit UI to verify camera status, live video, and snapshots.
4. Use the backend endpoints for diagnostics:
   - `GET /scan`
   - `GET /status`
   - `GET /device_info`
   - `GET /profiles`

## Project Structure

`camera_app/`

- `backend/` - FastAPI backend and camera services
- `frontend/` - Streamlit dashboard
- `snapshots/` - Stored snapshot images
- `recordings/` - Saved daily recordings
- `.env.example` - Example environment variables
- `requirements.txt` - Python dependencies

## Notes

- This system is designed for future multi-camera support.
- Credentials are managed through `.env` and not hardcoded.
