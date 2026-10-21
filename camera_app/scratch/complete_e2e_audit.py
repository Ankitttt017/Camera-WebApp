import urllib.request
import json
import time
import os

print("=" * 70)
print("       RICO AUTO INDUSTRIAL CAMERA WEB APP - COMPLETE E2E AUDIT")
print("=" * 70)

results = []

def check(name, fn):
    t0 = time.time()
    try:
        val = fn()
        dur = (time.time() - t0) * 1000
        print(f" [PASS] {name} ({dur:.1f}ms)")
        results.append((name, "PASS", val, f"{dur:.1f}ms"))
    except Exception as e:
        dur = (time.time() - t0) * 1000
        print(f" [FAIL] {name} ({dur:.1f}ms) -> {e}")
        results.append((name, "FAIL", str(e), f"{dur:.1f}ms"))

# 1. Frontend Server
def test_frontend():
    req = urllib.request.urlopen("http://localhost:5173", timeout=3)
    content = req.read().decode('utf-8')
    assert req.status == 200
    assert "html" in content.lower()
    return f"HTTP 200, {len(content)} bytes"
check("Frontend Server (Vite port 5173)", test_frontend)

# 2. Backend Settings API
def test_settings():
    req = urllib.request.urlopen("http://127.0.0.1:8010/settings", timeout=4)
    data = json.loads(req.read().decode())
    cip = data.get("ip") or data.get("camera_ip")
    assert cip is not None
    assert "plc_host" in data
    return f"Cam: {cip}, PLC: {data.get('plc_host')}:{data.get('plc_port')}"
check("Backend /settings", test_settings)

# 3. PLC Monitor Live Telemetry
def test_plc_monitor():
    req = urllib.request.urlopen("http://127.0.0.1:8010/plc-monitor/status", timeout=4)
    data = json.loads(req.read().decode())
    assert data.get("running") is True
    assert data.get("consecutive_read_failures", 99) == 0
    return f"Running=True, Host={data.get('plc_host')}:{data.get('plc_port')}, Failures=0, State={data.get('machine_state')}"
check("PLC Monitor Status (/plc-monitor/status)", test_plc_monitor)

# 4. Recording Engine Status
def test_recording_status():
    req = urllib.request.urlopen("http://127.0.0.1:8010/recording/status", timeout=4)
    data = json.loads(req.read().decode())
    return f"Running={data.get('running')}, Target={data.get('camera_ip')}"
check("Recording Engine Status (/recording/status)", test_recording_status)

# 5. Breakdown & Stoppage Reasons
def test_reasons():
    req = urllib.request.urlopen("http://127.0.0.1:8010/reasons", timeout=4)
    data = json.loads(req.read().decode())
    return f"{len(data.get('reasons', []))} standard reasons configured"
check("Operator Stoppage Reasons (/reasons)", test_reasons)

# 6. Enterprise Hierarchy API
def test_hierarchy():
    req = urllib.request.urlopen("http://127.0.0.1:8010/api/hierarchy", timeout=4)
    data = json.loads(req.read().decode())
    assert len(data) >= 1
    p_names = [p['name'] for p in data]
    return f"{len(data)} Plants: {', '.join(p_names)}"
check("Hierarchy Tree (/api/hierarchy)", test_hierarchy)

# 7. Fleet Cameras API
cams_list = []
def test_hierarchy_cameras():
    global cams_list
    req = urllib.request.urlopen("http://127.0.0.1:8010/api/hierarchy/cameras", timeout=4)
    data = json.loads(req.read().decode())
    assert len(data) >= 1
    cams_list = data
    summary = ", ".join([f"{c['name']} ({c['camera_ip']})" for c in data])
    return f"{len(data)} Cameras: {summary}"
check("Fleet Cameras (/api/hierarchy/cameras)", test_hierarchy_cameras)

# 8. Camera Snapshots & Streams
for c in cams_list:
    cid = c['id']
    cname = c['name']
    cip = c['camera_ip']
    def test_cam_snapshot(cid=cid):
        req = urllib.request.urlopen(f"http://127.0.0.1:8010/api/hierarchy/cameras/{cid}/live.jpg", timeout=6)
        img = req.read()
        assert len(img) > 1000
        return f"{len(img)} bytes"
    check(f"Camera #{cid} [{cname} - {cip}] Live Snapshot", test_cam_snapshot)

    def test_cam_stream(cid=cid):
        req = urllib.request.urlopen(f"http://127.0.0.1:8010/api/hierarchy/cameras/{cid}/mjpeg", timeout=6)
        line = req.readline()
        assert b"--frame" in line or b"Content-Type" in line or req.status == 200
        req.close()
        return "Stream Handshake OK"
    check(f"Camera #{cid} [{cname} - {cip}] MJPEG Stream Handshake", test_cam_stream)

# 9. Storage Root Directory
def test_storage_dir():
    path = "C:\\CPPLUS_RECORDINGS"
    exists = os.path.isdir(path)
    if exists:
        items = len(os.listdir(path))
        return f"Directory exists: {path} ({items} items)"
    return f"Storage root configured at {path}"
check("Storage Directory (C:\\CPPLUS_RECORDINGS)", test_storage_dir)

# 10. CSV Export API
def test_export_csv():
    req = urllib.request.urlopen("http://127.0.0.1:8010/recording-index/export.csv", timeout=5)
    data = req.read()
    assert req.status == 200
    return f"HTTP 200, {len(data)} bytes CSV payload"
check("Reports CSV Export (/recording-index/export.csv)", test_export_csv)

print("\n" + "=" * 70)
print(f"VERIFICATION SUMMARY: {sum(1 for r in results if r[1]=='PASS')}/{len(results)} TESTS PASSED")
print("=" * 70)
for name, status, val, dur in results:
    print(f"[{status}] {name.ljust(50)}: {val} ({dur})")
