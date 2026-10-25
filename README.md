# RICO AUTO INDUSTRIES — Smart Camera & Machine Event Recording WebApp

> **Enterprise Machine Event Monitoring, AI Video Diagnostics, and Downtime Tracking System**  
> Designed for real-time monitoring of industrial machinery (e.g. Die Casting machines, CNC lines), automated PLC-triggered event recording, root cause analysis (5-Whys / TPM), and predictive downtime analytics.

📖 **For complete technical architecture, API references, SQL Server database schemas, and PM2 deployment guide, see the [Comprehensive Project Documentation](PROJECT_DOCUMENTATION.md).**

---

## 📁 Project Architecture & Directory Structure

```text
Camera-WebApp/
├── .github/workflows/deploy.yml   # Push to main → self-hosted runner deploys to the Linux server (PM2)
├── camera_app/
│   ├── backend/                   # Python FastAPI backend (port 8010)
│   │   ├── cpplus_helper.py       # Main server: live video/audio, PLC monitor, recording, transcription, reports
│   │   ├── hierarchy_api.py       # Plant ➔ Department ➔ Line ➔ Machine ➔ Camera APIs (/api/hierarchy)
│   │   ├── stream_pool.py         # Per-camera live stream workers (self-healing)
│   │   ├── speech_gate.py         # Silero VAD speech gate: operator voice only in live/clean audio
│   │   ├── hinglish.py            # Devanagari → Hinglish transcript transliteration
│   │   ├── shop_vocabulary.py     # Corrects mis-heard shop-floor terms ("Gay polis" → "Die polish")
│   │   ├── db.py                  # SQL Server connection (dev_ tables locally, production tables on server)
│   │   └── init_hierarchy_db.py   # Creates the hierarchy tables (one-time setup)
│   │
│   ├── frontend/                  # React 19 + TypeScript + Vite
│   │   ├── src/
│   │   │   ├── App.tsx            # App shell, Live View, Event Report, reason editor, video player
│   │   │   ├── LiveStreamImage.tsx# Self-reconnecting live MJPEG viewer
│   │   │   ├── VideoTranscript.tsx# Timed captions + operator voice panel in the video player
│   │   │   ├── MultiCamGrid.tsx   # Multi-camera grid view
│   │   │   ├── HierarchyManager.tsx # Plants & Cameras setup (live / event recording mode)
│   │   │   ├── CameraEditModal.tsx# Camera edit and connection test
│   │   │   ├── SettingsHub.tsx    # Settings & Admin page
│   │   │   ├── api.ts             # API client and types
│   │   │   ├── downtimeData.ts    # Downtime reason hierarchy (category → sub-reason)
│   │   │   ├── styles.css         # Styles
│   │   │   └── main.tsx           # React entry point
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── .env.example               # Environment variables template (copy to .env)
│   ├── requirements.txt           # Python dependencies
│   └── helper_settings.json       # Camera + PLC settings for event recording
│
├── scripts/                       # Windows helpers: start/restart backend locally
├── PROJECT_DOCUMENTATION.md       # Full technical documentation
├── PROJECT_PRESENTATION.md/.pptx  # Project presentation
└── README.md
```

---

## 🚀 Key Modules & Capabilities

### 1. Live View (`LivePage` in `App.tsx`)
* **Real-Time Video:** Low-latency RTSP camera streaming via TCP with dual-stream support (Single View & Multi-Grid View).
* **Industrial Telemetry:** Live machine state badge (Running / Minor Stoppage / Breakdown), PLC status indicator, and frame counter.
* **Filter Dropdowns:** Plant, Department, Line, and Camera cascade selectors.

### 2. Incident & Event Reports (`SavedPage` in `App.tsx`)
* **Comprehensive Event Log:** Complete chronological table of automated stoppages and breakdown clips.
* **TPM Root Cause Tracking:** Modal dialog for operators and maintenance engineers to log root cause category, machine reason, action note, responsible department, and target completion date.
* **Excel Export:** Instant download of downtime reports formatted for operational management.

### 3. Recording Player & Voice Notes
* **Clean audio playback:** machine noise between words is muted; download gives the same clean copy.
* **Timed captions:** what the operator says appears under the video, with a side panel of every voice note (video time + clock time); click a line to replay it.

### 4. Plant & Cameras Management (`HierarchyManager.tsx` & `CameraEditModal.tsx`)
* **Organizational Hierarchy:** Full multi-tier structure (Plant ➔ Department ➔ Line ➔ Machine ➔ Camera).
* **Live Camera Diagnostics:** In-modal connection testing (Ping, HTTP Port, RTSP Stream validation).

---

## 🛠️ How to Run Locally

### Backend (Python 3.10+)
```powershell
cd camera_app
.\.venv\Scripts\activate
python backend\cpplus_helper.py
```
*Backend runs on:* `http://127.0.0.1:8010`

### Frontend (Node.js 18+)
```powershell
cd camera_app\frontend
npm install
npm run dev
```
*Frontend runs on:* `http://localhost:5173`

### Production Build
```powershell
cd camera_app\frontend
npm run build
```

---

## 🔒 Security & Access Control
* **Role-Based Controls:** `superadmin`, `admin`, and `operator` permission tiers.
* **Protected Operations:** Camera configurations, PLC host settings, and manual start/stop recording require administrative authorization.
