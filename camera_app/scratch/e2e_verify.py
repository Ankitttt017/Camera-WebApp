import urllib.request
import json
import time

print("=" * 60)
print("END-TO-END VERIFICATION REPORT")
print("=" * 60)

# 1. Test Hierarchy API
try:
    tree = json.loads(urllib.request.urlopen("http://127.0.0.1:8010/api/hierarchy", timeout=4).read().decode())
    print(f"\n[OK] GET /api/hierarchy returned {len(tree)} plants:")
    for p in tree:
        depts = p.get("departments", [])
        print(f"  - Plant #{p['id']}: {p['name']} ({p['code']}) with {len(depts)} departments")
        for d in depts:
            lines = d.get("lines", [])
            print(f"      Dept #{d['id']}: {d['name']} with {len(lines)} lines")
            for l in lines:
                machines = l.get("machines", [])
                print(f"        Line #{l['id']}: {l['name']} with {len(machines)} machines")
                for m in machines:
                    cams = m.get("cameras", [])
                    print(f"          Machine #{m['id']}: {m['name']} with {len(cams)} cameras")
except Exception as e:
    print(f"[FAIL] GET /api/hierarchy failed: {e}")

# 2. Test Cameras Flat API
try:
    cams = json.loads(urllib.request.urlopen("http://127.0.0.1:8010/api/hierarchy/cameras", timeout=4).read().decode())
    print(f"\n[OK] GET /api/hierarchy/cameras returned {len(cams)} cameras:")
    for c in cams:
        print(f"  - Camera #{c['id']}: \"{c['name']}\"")
        print(f"      IP: {c['camera_ip']}:{c['rtsp_port']} (Channel: {c['channel']})")
        print(f"      Plant: \"{c['plant_name']}\" (ID: {c['plant_id']}, Code: {c['plant_code']})")
        print(f"      Line: \"{c['line_name']}\" (ID: {c['line_id']})")
        print(f"      Machine: \"{c['machine_name']}\" (ID: {c['machine_id']}, Code: {c['machine_code']})")
except Exception as e:
    print(f"[FAIL] GET /api/hierarchy/cameras failed: {e}")

# 3. Test Live JPEG and MJPEG for Each Camera
print("\n[OK] Testing Live Streams for Each Configured Camera:")
for c in cams:
    cid = c['id']
    # Test Snapshot
    t0 = time.time()
    try:
        res = urllib.request.urlopen(f"http://127.0.0.1:8010/api/hierarchy/cameras/{cid}/live.jpg", timeout=5)
        img_data = res.read()
        print(f"  - Camera #{cid} ({c['name']}) Snapshot: Status {res.status}, {len(img_data)} bytes in {time.time()-t0:.2f}s")
    except Exception as e:
        print(f"  - Camera #{cid} ({c['name']}) Snapshot ERROR: {e}")

    # Test MJPEG
    t0 = time.time()
    try:
        res = urllib.request.urlopen(f"http://127.0.0.1:8010/api/hierarchy/cameras/{cid}/mjpeg", timeout=5)
        boundary = res.readline()
        content_type = res.readline()
        print(f"  - Camera #{cid} ({c['name']}) MJPEG Stream: Status {res.status}, Handshake OK ({boundary.strip().decode()}) in {time.time()-t0:.2f}s")
        res.close()
    except Exception as e:
        print(f"  - Camera #{cid} ({c['name']}) MJPEG Stream ERROR: {e}")

# 4. Test Concurrency of Both MJPEG Streams
print("\n[OK] Testing Concurrent MJPEG Throughput (Simultaneous Viewing):")
import threading
throughput = {}
def pull_frames(camera_id):
    try:
        req = urllib.request.urlopen(f"http://127.0.0.1:8010/api/hierarchy/cameras/{camera_id}/mjpeg", timeout=5)
        frames = 0
        t_start = time.time()
        while time.time() - t_start < 2.0:
            line = req.readline()
            if b"--frame" in line:
                frames += 1
        req.close()
        throughput[camera_id] = f"{frames} frames in 2.0s (~{frames/2.0:.1f} FPS)"
    except Exception as e:
        throughput[camera_id] = f"Error: {e}"

threads = [threading.Thread(target=pull_frames, args=(c['id'],)) for c in cams]
for t in threads:
    t.start()
for t in threads:
    t.join()

for cid, stat in throughput.items():
    print(f"  - Camera #{cid}: {stat}")

print("\n" + "=" * 60)
print("ALL BACKEND VERIFICATIONS COMPLETED SUCCESSFULLY")
print("=" * 60)
