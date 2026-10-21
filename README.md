# RICO AUTO INDUSTRIES — Smart Camera & Machine Event Recording WebApp

> **Enterprise Machine Event Monitoring, AI Video Diagnostics, and Downtime Tracking System**  
> Designed for real-time monitoring of industrial machinery (e.g. Die Casting machines, CNC lines), automated PLC-triggered event recording, root cause analysis (5-Whys / TPM), and predictive downtime analytics.

📖 **For complete technical architecture, API references, SQL Server database schemas, and PM2 deployment guide, see the [Comprehensive Project Documentation](PROJECT_DOCUMENTATION.md).**

---

## 📁 Project Architecture & Directory Structure

```text
Camera-WebApp/
├── audio_benchmark_samples/       # Cleaned benchmark .wav samples for speech/noise isolation
├── camera_app/
│   ├── backend/                   # Python FastAPI & RTSP backend services
│   │   ├── cpplus_helper.py       # Primary server (RTSP streaming, PLC monitor, event indexing)
│   │   ├── hierarchy_api.py       # Plant ➔ Department ➔ Line ➔ Machine ➔ Camera CRUD APIs
│   │   ├── stream_pool.py         # Multi-camera concurrent RTSP stream management
│   │   ├── db.py                  # Database abstraction layer (SQLite / SQL Server)
│   │   ├── init_hierarchy_db.py   # Database initialization and seed script
│   │   ├── rnnoise_models/        # RNNoise recurrent neural network noise reduction models
│   │   └── hierarchy.db           # SQLite database for plant & camera hierarchy
│   │
│   ├── frontend/                  # React (TypeScript) + Vite Enterprise Web Application
│   │   ├── src/
│   │   │   ├── App.tsx            # Main application shell, Live View, Event Report & Modals
│   │   │   ├── Dashboard.tsx      # Machine Stoppage Analytics, Pareto charts, MTBF/MTTR KPIs
│   │   │   ├── HierarchyManager.tsx # Plant & Cameras management page with interactive deck
│   │   │   ├── CameraEditModal.tsx# Camera edit and connection testing modal
│   │   │   ├── MultiCamGrid.tsx   # Multi-camera grid live view component
│   │   │   ├── api.ts             # API client, TypeScript interfaces, and REST handlers
│   │   │   ├── downtimeData.ts    # Industrial downtime taxonomy and historical statistics
│   │   │   ├── styles.css         # Enterprise Light design system and responsive styles
│   │   │   └── main.tsx           # React entry point
│   │   ├── package.json           # Frontend dependencies & scripts
│   │   └── vite.config.ts         # Vite build configuration
│   │
│   ├── recordings/                # Local storage for captured event videos and transcripts
│   ├── requirements.txt           # Python dependencies for the backend
│   └── helper_settings.json       # Persisted camera and PLC runtime configurations
│
├── runtime_logs/                  # Application runtime and process logs
├── scripts/                       # Maintenance and service restart automation scripts
├── TECHNICAL_DOCUMENTATION.md     # In-depth technical architecture documentation
└── README.md                      # Project overview & operational guide
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

### 3. Machine Stoppage Analytics (`Dashboard.tsx`)
* **Pareto Loss Analysis:** Identifies top stoppage categories (Breakdown, Minor Stoppage, Changeover, Tool Change, Quality Loss).
* **Operational KPIs:** Availability Rate, MTTR (Mean Time to Recover), MTBF (Mean Time Between Failures), and total lost hours.
* **Visual Trends:** High-contrast bar charts and distribution graphs designed in Enterprise Light theme.

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
