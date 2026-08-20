# Camera-WebApp Technical Documentation

## 1. Overall Project Structure

Root folder: `Camera-WebApp`

- `README.md`
  - Project overview, setup and run instructions

- `camera_app/`
  - Main application workspace
  - `backend/` — FastAPI helper service and camera recording logic
  - `frontend/` — React operator console
  - `recordings/` — Generated camera video files
  - `snapshots/` — Generated snapshot images
  - `model_cache/` — cached offline ML/transcription models
  - `transcription_tmp/` — temporary transcription files
  - `helper_settings.json` — helper configuration
  - `requirements.txt` — backend Python dependencies

---

## 2. Tools and Technologies Used

### Backend
- Python 3.11+ (recommended)
- FastAPI
- Uvicorn
- SQLAlchemy
- OpenCV (`opencv-python`)
- ONVIF support via `onvif-zeep`
- HTTP requests via `requests`
- dotenv config via `python-dotenv`
- `faster-whisper` for local transcription support
- SQLite for lightweight event/log storage

### Frontend
- React
- TypeScript
- Vite
- Browser Fetch API for backend communication

### Media / Utilities
- `ffmpeg` included under `tools/ffmpeg/`
- Local camera access via RTSP / HTTP / ONVIF protocols

---

## 3. Folder-by-Folder Breakdown

### `camera_app/backend/`
Contains the backend service and camera logic.

Important files:
- `main.py`
  - FastAPI app
  - Health-check loop
  - API endpoints
- `config.py`
  - Loads `.env`
  - Defines camera settings, ports, paths, database and storage roots
- `camera_service.py`
  - Camera discovery and protocol detection
  - RTSP URL generation
  - HTTP device info fetch
  - ONVIF profile discovery
  - Event logging into SQLite
- `stream.py`
  - RTSP streaming manager
  - Background thread to keep camera frames flowing
  - Frame stats and base64 encoding for UI
- `detector.py`
  - Motion detection using OpenCV background subtraction
  - Event logging of detected motion areas
- `recorder.py`
  - Saves snapshots and writes video files
  - Organizes recordings by date
- `models.py`
  - SQLAlchemy models:
    - `EventLog`
    - `CameraStatus`

### `camera_app/frontend/`
Contains the React operator UI.

Important files:
- `package.json`
  - Vite + React dependencies
- `src/api.ts`
  - API request wrappers
  - Backend helper URL configuration
  - Data models and payload builders
- `src/App.tsx`
  - Main UI logic, state management, dashboard and controls

Other:
- `public/` — static assets
- `index.html` — frontend entry HTML

---

## 4. What the Backend Does

### Startup behavior
- Creates SQLite tables via `Base.metadata.create_all(...)`
- Starts a background `connection_health_check()` task

### Camera connection workflow
1. Reads camera configuration from `.env`
   - `CAMERA_IP`
   - `CAMERA_USER`
   - `CAMERA_PASSWORD`
   - `RTSP_PORTS`
   - `HTTP_PORTS`
   - `ONVIF_PORTS`

2. Builds a protocol report in `camera_service.build_protocol_report(...)`
   - Ping camera
   - Scan configured ports
   - Attempt RTSP detection when RTSP ports are open
   - Try HTTP info discovery on HTTP ports
   - Try ONVIF discovery on ONVIF ports

3. If RTSP is found:
   - `CameraStream.set_rtsp_url(...)`
   - `CameraStream.start()` begins reading frames

4. `CameraStream._run()` loop
   - Opens `cv2.VideoCapture(rtsp_url)`
   - Reads frames continuously
   - Stores current frame under lock
   - Computes FPS, width, height
   - Reconnects automatically if stream drops

### Motion detection
- `MotionDetector` uses OpenCV MOG2 background subtraction
- Every frame passed to `analyze_frame(...)`
- Detects contours above a configured sensitivity
- Records motion events in memory
- Provides API endpoints for analytics and events

---

## 5. What Each Backend API Does

### Health and discovery
- `GET /scan`
  - Performs full camera protocol detection
  - Returns ping, open ports, RTSP URL, HTTP info, ONVIF info
- `GET /status`
  - Returns connection status plus stream stats
- `GET /device_info`
  - Fetches HTTP camera info using digest auth
- `GET /profiles`
  - Discovers ONVIF service profiles

### Camera assets
- `GET /snapshot`
  - Saves current frame as a snapshot image
- `GET /events`
  - Returns motion event log
- `GET /analytics`
  - Returns motion detection analytics for current frame
- `GET /frame`
  - Returns current camera frame as base64 JPEG

### Recordings and snapshots listing
- `GET /recordings`
  - Lists video files in `recordings/`
- `GET /recordings/{filename}`
  - Serves recording file
- `GET /snapshots`
  - Lists snapshot image files
- `GET /snapshots/{filename}`
  - Serves snapshot image

---

## 6. Camera Connection Logic Explained

### Protocol discovery
- `ping_camera_sync(...)`
  - Uses OS `ping` to verify camera reachability
- `scan_ports(...)`
  - Checks open TCP ports for RTSP, HTTP, and ONVIF
- `detect_rtsp(...)`
  - Builds candidate RTSP URLs using typical camera paths
  - Tries each URL with `cv2.VideoCapture`
- `fetch_http_info(...)`
  - Tries HTTP endpoints such as `/ISAPI/System/deviceInfo`
  - Uses digest auth if required
- `discover_onvif(...)`
  - Uses `ONVIFCamera` to get available media profiles

### RTSP stream usage
- Once RTSP URL is found, the app keeps a live stream open
- It reads frames continuously
- Frames are made available for:
  - frontend live view
  - snapshot capture
  - motion analytics

### Resilience
- If RTSP open fails, the stream retries
- `MAX_RECONNECT_ATTEMPTS` and `RECONNECT_INTERVAL` control reconnection
- Errors are stored in `status_cache`

---

## 7. Recording and Storage Design

### Storage layout
- `config.py` defines:
  - `RECORDINGS_ROOT`
  - `SNAPSHOTS_ROOT`
- `recorder.py` organizes output by date:
  - `recordings/YYYY/MM/DD/`

### Video and snapshot handling
- `save_recording_frame(...)`
  - Saves individual JPEG snapshots
- `write_video(...)`
  - Writes a sequence of frames to MP4 using OpenCV

### Metadata
- Camera events and protocol activity are logged in SQLite
- `EventLog` contains:
  - category
  - message
  - details
  - timestamp

---

## 8. Frontend Integration

### Main frontend responsibilities
- Provides a dashboard for:
  - live camera preview
  - device/connection status
  - events and analytics
  - saved recordings
- Communicates with backend using REST calls
- Uses local storage for camera settings

### API integration
- `src/api.ts` offers:
  - `getJson(...)` and `postJson(...)`
  - payload builders for camera / PLC configuration
- The frontend expects the backend helper to run on port `8010`

---

## 9. What You Built: Step-by-Step Logic

### Step 1: Configured environment
- Created `config.py`
- Loaded `.env`
- Defined camera IP, credentials, ports, recording directories

### Step 2: Built protocol discovery
- Implemented ping + port scan
- Added RTSP URL generation and camera open test
- Added HTTP and ONVIF discovery fallback
- Logged discovery results to SQLite

### Step 3: Built RTSP stream manager
- Created `CameraStream`
- Added background thread reading frames
- Stored and exposed frame stats
- Added base64 encoding for web delivery

### Step 4: Added analytics
- Created `MotionDetector`
- Used OpenCV background subtraction
- Detected motion contours and events
- Provided API endpoints for analytics and events

### Step 5: Added snapshot/recording storage
- Created recording snapshot save helpers
- Added endpoints to list and serve saved files
- Organized files by date for easier review

### Step 6: Built frontend operator UI
- Set up React + Vite
- Connected UI to backend helper
- Added settings storage and live data polling

---

## 10. Professional Summary

This project is a complete end-to-end camera monitoring and recording system with:
- automatic camera protocol detection
- live RTSP stream capture
- snapshot and recording management
- event detection and logging
- React-based operator dashboard

The architecture separates:
- backend service for camera and storage logic
- frontend app for operator interaction
- local storage for recordings, snapshots, and event logs

The generated PDF version of this documentation is available in the workspace.
