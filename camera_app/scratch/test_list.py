import urllib.request
import json

req = urllib.request.Request(
    'http://127.0.0.1:8010/recording-index/list',
    data=json.dumps({"page": 1, "page_size": 5, "storage_root": "/home/automation/apps/Camera-WebApp/camera_app/recordings"}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
try:
    res = json.loads(urllib.request.urlopen(req, timeout=3).read().decode())
    print("Total:", res.get("total"))
    for r in res.get("records", [])[:5]:
        print(r.get("started_at"), r.get("event_type"), r.get("reason"), r.get("file_name"))
except Exception as e:
    print("Error:", e)
