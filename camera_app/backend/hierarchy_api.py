"""
FastAPI Router for Dynamic Plant / Department / Line / Machine / Camera Hierarchy
Supports full CRUD, live multi-camera streaming, and connectivity testing.
"""
import os
import re
import socket
import time
from typing import Any, Dict, List, Optional
import cv2
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from .db import get_db_connection, PrefixCursor
    from .stream_pool import stream_pool
except (ImportError, ValueError):
    from db import get_db_connection, PrefixCursor
    from stream_pool import stream_pool

router = APIRouter(prefix="/api/hierarchy", tags=["Hierarchy"])


# --- Pydantic Models ---

class PlantCreate(BaseModel):
    code: str
    name: str
    location: Optional[str] = None
    is_active: bool = True

class PlantUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    location: Optional[str] = None
    is_active: Optional[bool] = None


class DepartmentCreate(BaseModel):
    plant_id: int
    code: str
    name: str
    is_active: bool = True

class DepartmentUpdate(BaseModel):
    plant_id: Optional[int] = None
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class LineCreate(BaseModel):
    department_id: int
    code: str
    name: str
    is_active: bool = True

class LineUpdate(BaseModel):
    department_id: Optional[int] = None
    code: Optional[str] = None
    name: Optional[str] = None
    is_active: Optional[bool] = None


class MachineCreate(BaseModel):
    line_id: int
    code: str
    name: str
    plc_enabled: bool = True
    plc_host: Optional[str] = None
    plc_port: int = 5000
    plc_device: str = "X"
    plc_address: str = "4A"
    is_active: bool = True

class MachineUpdate(BaseModel):
    line_id: Optional[int] = None
    code: Optional[str] = None
    name: Optional[str] = None
    plc_enabled: Optional[bool] = None
    plc_host: Optional[str] = None
    plc_port: Optional[int] = None
    plc_device: Optional[str] = None
    plc_address: Optional[str] = None
    is_active: Optional[bool] = None


class CameraCreate(BaseModel):
    machine_id: int
    name: str
    camera_ip: str
    http_port: int = 80
    rtsp_port: int = 554
    username: str = "admin"
    password: str = "Admin@123"
    channel: int = 1
    rtsp_path: str = "/video/live?channel=1&subtype=0"
    sub_rtsp_path: str = "/video/live?channel=1&subtype=1"
    is_active: bool = True

class CameraUpdate(BaseModel):
    machine_id: Optional[int] = None
    name: Optional[str] = None
    camera_ip: Optional[str] = None
    http_port: Optional[int] = None
    rtsp_port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    channel: Optional[int] = None
    rtsp_path: Optional[str] = None
    sub_rtsp_path: Optional[str] = None
    is_active: Optional[bool] = None


class TestCameraRequest(BaseModel):
    camera_ip: str
    http_port: int = 80
    rtsp_port: int = 554
    username: str = "admin"
    password: str = "Admin@123"
    channel: int = 1
    rtsp_path: str = "/video/live?channel=1&subtype=0"


class TestPlcRequest(BaseModel):
    plc_host: str
    plc_port: int = 5000
    plc_device: str = "X"
    plc_address: str = "4A"


# --- Helpers ---

def get_table_name(base: str) -> str:
    env = os.environ.get('ENVIRONMENT', 'development')
    prefix = os.environ.get('DB_TABLE_PREFIX_DEV', 'dev_') if env == 'development' else ''
    return f"{prefix}cam_{base}"


# --- Hierarchy Tree Endpoint ---

@router.get("")
def get_hierarchy_tree():
    """Returns the complete Plant -> Department -> Line -> Machine -> Camera tree."""
    t_plants = get_table_name("plants")
    t_departments = get_table_name("departments")
    t_lines = get_table_name("lines")
    t_machines = get_table_name("machines")
    t_cameras = get_table_name("cameras")
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Fetch plants
        cursor.execute(f"SELECT id, code, name, location, is_active FROM {t_plants} ORDER BY name ASC")
        plants = [{"id": r[0], "code": r[1], "name": r[2], "location": r[3], "is_active": bool(r[4]), "departments": []} for r in cursor.fetchall()]
        plant_map = {p["id"]: p for p in plants}
        
        # 2. Fetch departments
        cursor.execute(f"SELECT id, plant_id, code, name, is_active FROM {t_departments} ORDER BY name ASC")
        depts = [{"id": r[0], "plant_id": r[1], "code": r[2], "name": r[3], "is_active": bool(r[4]), "lines": []} for r in cursor.fetchall()]
        dept_map = {d["id"]: d for d in depts}
        for d in depts:
            if d["plant_id"] in plant_map:
                plant_map[d["plant_id"]]["departments"].append(d)
                
        # 3. Fetch lines
        cursor.execute(f"SELECT id, department_id, code, name, is_active FROM {t_lines} ORDER BY name ASC")
        lines = [{"id": r[0], "department_id": r[1], "code": r[2], "name": r[3], "is_active": bool(r[4]), "machines": []} for r in cursor.fetchall()]
        line_map = {l["id"]: l for l in lines}
        for l in lines:
            if l["department_id"] in dept_map:
                dept_map[l["department_id"]]["lines"].append(l)
                
        # 4. Fetch machines
        cursor.execute(f"SELECT id, line_id, code, name, plc_enabled, plc_host, plc_port, plc_device, plc_address, is_active FROM {t_machines} ORDER BY name ASC")
        machines = [{"id": r[0], "line_id": r[1], "code": r[2], "name": r[3], "plc_enabled": bool(r[4]), "plc_host": r[5], "plc_port": r[6], "plc_device": r[7], "plc_address": r[8], "is_active": bool(r[9]), "cameras": []} for r in cursor.fetchall()]
        machine_map = {m["id"]: m for m in machines}
        for m in machines:
            if m["line_id"] in line_map:
                line_map[m["line_id"]]["machines"].append(m)
                
        # 5. Fetch cameras
        cursor.execute(f"SELECT id, machine_id, name, camera_ip, http_port, rtsp_port, username, channel, rtsp_path, sub_rtsp_path, is_active FROM {t_cameras} ORDER BY name ASC")
        for r in cursor.fetchall():
            cam = {
                "id": r[0],
                "machine_id": r[1],
                "name": r[2],
                "camera_ip": r[3],
                "http_port": r[4],
                "rtsp_port": r[5],
                "username": r[6],
                "channel": r[7],
                "rtsp_path": r[8],
                "sub_rtsp_path": r[9],
                "is_active": bool(r[10]),
            }
            if cam["machine_id"] in machine_map:
                machine_map[cam["machine_id"]]["cameras"].append(cam)
                
    return plants


@router.get("/cameras")
def get_all_cameras(plant_id: Optional[int] = None, department_id: Optional[int] = None, line_id: Optional[int] = None, machine_id: Optional[int] = None):
    """Returns flat list of cameras with parent hierarchy details attached."""
    t_plants = get_table_name("plants")
    t_departments = get_table_name("departments")
    t_lines = get_table_name("lines")
    t_machines = get_table_name("machines")
    t_cameras = get_table_name("cameras")
    
    where_clauses = ["c.is_active = 1"]
    params = []
    if plant_id:
        where_clauses.append("p.id = ?")
        params.append(plant_id)
    if department_id:
        where_clauses.append("d.id = ?")
        params.append(department_id)
    if line_id:
        where_clauses.append("l.id = ?")
        params.append(line_id)
    if machine_id:
        where_clauses.append("m.id = ?")
        params.append(machine_id)
        
    where_sql = " AND ".join(where_clauses)
    query = f"""
    SELECT 
        c.id, c.name, c.camera_ip, c.http_port, c.rtsp_port, c.username, c.channel, c.rtsp_path, c.sub_rtsp_path, c.is_active,
        m.id AS machine_id, m.name AS machine_name, m.code AS machine_code, m.plc_enabled, m.plc_host, m.plc_port, m.plc_device, m.plc_address,
        l.id AS line_id, l.name AS line_name, l.code AS line_code,
        d.id AS department_id, d.name AS department_name, d.code AS department_code,
        p.id AS plant_id, p.name AS plant_name, p.code AS plant_code
    FROM {t_cameras} c
    JOIN {t_machines} m ON c.machine_id = m.id
    JOIN {t_lines} l ON m.line_id = l.id
    JOIN {t_departments} d ON l.department_id = d.id
    JOIN {t_plants} p ON d.plant_id = p.id
    WHERE {where_sql}
    ORDER BY p.name, d.name, l.name, m.name, c.name
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, tuple(params))
        cols = [c[0] for c in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]


# --- Connectivity Testing Endpoints ---

@router.post("/test-camera")
def test_camera_connection(req: TestCameraRequest):
    """Test ping, TCP port, and RTSP stream response."""
    results = {
        "ip": req.camera_ip,
        "ping": False,
        "http_open": False,
        "rtsp_open": False,
        "rtsp_stream_ok": False,
        "message": ""
    }
    
    # Check socket on RTSP port
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            if s.connect_ex((req.camera_ip, req.rtsp_port)) == 0:
                results["rtsp_open"] = True
    except Exception:
        pass

    # Check socket on HTTP port
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            if s.connect_ex((req.camera_ip, req.http_port)) == 0:
                results["http_open"] = True
    except Exception:
        pass

    # Test RTSP stream via OpenCV
    rtsp_url = f"rtsp://{req.username}:{req.password}@{req.camera_ip}:{req.rtsp_port}{req.rtsp_path}"
    try:
        cap = cv2.VideoCapture()
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 4000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 4000)
        cap.open(rtsp_url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            ok, frame = cap.read()
            if ok and frame is not None:
                results["rtsp_stream_ok"] = True
                results["message"] = f"Connected successfully! Resolution: {frame.shape[1]}x{frame.shape[0]}"
            cap.release()
    except Exception as exc:
        results["message"] = f"RTSP test error: {exc}"

    if not results["rtsp_stream_ok"]:
        if not results["rtsp_open"]:
            results["message"] = f"Could not reach RTSP port {req.rtsp_port} on {req.camera_ip}. Verify network & IP."
        else:
            results["message"] = "RTSP port is open, but authentication or stream path failed. Verify credentials."

    return results


@router.post("/test-plc")
def test_plc_connection(req: TestPlcRequest):
    """Test TCP socket connection to Mitsubishi / SLMP PLC."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(3.0)
            res = s.connect_ex((req.plc_host, req.plc_port))
            if res == 0:
                return {
                    "ok": True,
                    "message": f"PLC reached successfully at {req.plc_host}:{req.plc_port}!"
                }
            else:
                return {
                    "ok": False,
                    "message": f"Connection refused/timed out on {req.plc_host}:{req.plc_port} (Error code: {res})"
                }
    except Exception as exc:
        return {"ok": False, "message": f"PLC connection error: {exc}"}


# --- Dynamic Live Stream per Camera ---

@router.get("/cameras/{camera_id}/live.jpg")
def camera_live_jpeg(camera_id: int):
    """Returns single real-time snapshot for this specific camera."""
    t_cameras = get_table_name("cameras")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT camera_ip, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path FROM {t_cameras} WHERE id = ?", (camera_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Camera not found")
        ip, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path = row

    # Use sub_rtsp_path if available for fast live preview
    path_to_use = sub_rtsp_path or rtsp_path
    worker = stream_pool.get_worker(camera_id, ip, rtsp_port, username, password, channel, path_to_use)
    jpeg, status, err = stream_pool.get_latest_jpeg(camera_id)
    
    if jpeg is None:
        # High Definition 16:9 placeholder with clear diagnostic guidance
        import numpy as np
        blank = np.zeros((720, 1280, 3), dtype=np.uint8)
        blank[:] = (15, 23, 42) # Industrial slate background
        # Border
        cv2.rectangle(blank, (10, 10), (1270, 710), (51, 65, 85), 2)
        cv2.putText(blank, f"CAMERA ID #{camera_id}  ({ip}:{rtsp_port})", (80, 280), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (248, 250, 252), 2)
        
        status_text = f"Connecting to RTSP..." if status == "connecting" else (err or f"Status: {status}")
        status_color = (250, 204, 21) if status == "connecting" else (90, 90, 245)
        cv2.putText(blank, status_text, (80, 360), cv2.FONT_HERSHEY_SIMPLEX, 0.95, status_color, 2)
        
        hint = "If RTSP fails: verify camera login password in 'Plant & Cameras' setup."
        cv2.putText(blank, hint, (80, 440), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (148, 163, 184), 1)
        _, enc = cv2.imencode('.jpg', blank, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        jpeg = enc.tobytes()

    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})


@router.get("/cameras/{camera_id}/mjpeg")
def camera_mjpeg_stream(camera_id: int):
    """Streams MJPEG stream for this specific camera."""
    t_cameras = get_table_name("cameras")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT camera_ip, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path FROM {t_cameras} WHERE id = ?", (camera_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Camera not found")
        ip, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path = row

    path_to_use = sub_rtsp_path or rtsp_path
    worker = stream_pool.get_worker(camera_id, ip, rtsp_port, username, password, channel, path_to_use)

    def frame_gen():
        while True:
            jpeg, _, _ = stream_pool.get_latest_jpeg(camera_id)
            if jpeg:
                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n\r\n'
                    + jpeg
                    + b'\r\n'
                )
            time.sleep(0.08) # ~12 fps

    return StreamingResponse(
        frame_gen(),
        media_type='multipart/x-mixed-replace; boundary=frame',
        headers={'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache'}
    )


# --- CRUD Endpoints ---

# 1. Plants
@router.post("/plants")
def create_plant(req: PlantCreate):
    t_plants = get_table_name("plants")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"INSERT INTO {t_plants} (code, name, location, is_active) VALUES (?, ?, ?, ?)", (req.code, req.name, req.location, req.is_active))
        cursor.execute("SELECT @@IDENTITY")
        new_id = int(cursor.fetchone()[0])
    return {"id": new_id, "message": "Plant created successfully"}

@router.put("/plants/{plant_id}")
def update_plant(plant_id: int, req: PlantUpdate):
    t_plants = get_table_name("plants")
    fields, values = [], []
    if req.code is not None: fields.append("code = ?"); values.append(req.code)
    if req.name is not None: fields.append("name = ?"); values.append(req.name)
    if req.location is not None: fields.append("location = ?"); values.append(req.location)
    if req.is_active is not None: fields.append("is_active = ?"); values.append(req.is_active)
    if not fields: return {"message": "No fields to update"}
    values.append(plant_id)
    with get_db_connection() as conn:
        conn.cursor().execute(f"UPDATE {t_plants} SET {', '.join(fields)} WHERE id = ?", tuple(values))
    return {"message": "Plant updated successfully"}

@router.delete("/plants/{plant_id}")
def delete_plant(plant_id: int):
    t_plants = get_table_name("plants")
    with get_db_connection() as conn:
        conn.cursor().execute(f"DELETE FROM {t_plants} WHERE id = ?", (plant_id,))
    return {"message": "Plant deleted successfully"}


# 2. Departments
@router.post("/departments")
def create_department(req: DepartmentCreate):
    t_departments = get_table_name("departments")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"INSERT INTO {t_departments} (plant_id, code, name, is_active) VALUES (?, ?, ?, ?)", (req.plant_id, req.code, req.name, req.is_active))
        cursor.execute("SELECT @@IDENTITY")
        new_id = int(cursor.fetchone()[0])
    return {"id": new_id, "message": "Department created successfully"}

@router.put("/departments/{department_id}")
def update_department(department_id: int, req: DepartmentUpdate):
    t_departments = get_table_name("departments")
    fields, values = [], []
    if req.plant_id is not None: fields.append("plant_id = ?"); values.append(req.plant_id)
    if req.code is not None: fields.append("code = ?"); values.append(req.code)
    if req.name is not None: fields.append("name = ?"); values.append(req.name)
    if req.is_active is not None: fields.append("is_active = ?"); values.append(req.is_active)
    if not fields: return {"message": "No fields to update"}
    values.append(department_id)
    with get_db_connection() as conn:
        conn.cursor().execute(f"UPDATE {t_departments} SET {', '.join(fields)} WHERE id = ?", tuple(values))
    return {"message": "Department updated successfully"}

@router.delete("/departments/{department_id}")
def delete_department(department_id: int):
    t_departments = get_table_name("departments")
    with get_db_connection() as conn:
        conn.cursor().execute(f"DELETE FROM {t_departments} WHERE id = ?", (department_id,))
    return {"message": "Department deleted successfully"}


# 3. Lines
@router.post("/lines")
def create_line(req: LineCreate):
    t_lines = get_table_name("lines")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"INSERT INTO {t_lines} (department_id, code, name, is_active) VALUES (?, ?, ?, ?)", (req.department_id, req.code, req.name, req.is_active))
        cursor.execute("SELECT @@IDENTITY")
        new_id = int(cursor.fetchone()[0])
    return {"id": new_id, "message": "Line created successfully"}

@router.put("/lines/{line_id}")
def update_line(line_id: int, req: LineUpdate):
    t_lines = get_table_name("lines")
    fields, values = [], []
    if req.department_id is not None: fields.append("department_id = ?"); values.append(req.department_id)
    if req.code is not None: fields.append("code = ?"); values.append(req.code)
    if req.name is not None: fields.append("name = ?"); values.append(req.name)
    if req.is_active is not None: fields.append("is_active = ?"); values.append(req.is_active)
    if not fields: return {"message": "No fields to update"}
    values.append(line_id)
    with get_db_connection() as conn:
        conn.cursor().execute(f"UPDATE {t_lines} SET {', '.join(fields)} WHERE id = ?", tuple(values))
    return {"message": "Line updated successfully"}

@router.delete("/lines/{line_id}")
def delete_line(line_id: int):
    t_lines = get_table_name("lines")
    with get_db_connection() as conn:
        conn.cursor().execute(f"DELETE FROM {t_lines} WHERE id = ?", (line_id,))
    return {"message": "Line deleted successfully"}


# 4. Machines
@router.post("/machines")
def create_machine(req: MachineCreate):
    t_machines = get_table_name("machines")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
        INSERT INTO {t_machines} (line_id, code, name, plc_enabled, plc_host, plc_port, plc_device, plc_address, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (req.line_id, req.code, req.name, req.plc_enabled, req.plc_host, req.plc_port, req.plc_device, req.plc_address, req.is_active))
        cursor.execute("SELECT @@IDENTITY")
        new_id = int(cursor.fetchone()[0])
    return {"id": new_id, "message": "Machine created successfully"}

@router.put("/machines/{machine_id}")
def update_machine(machine_id: int, req: MachineUpdate):
    t_machines = get_table_name("machines")
    fields, values = [], []
    if req.line_id is not None: fields.append("line_id = ?"); values.append(req.line_id)
    if req.code is not None: fields.append("code = ?"); values.append(req.code)
    if req.name is not None: fields.append("name = ?"); values.append(req.name)
    if req.plc_enabled is not None: fields.append("plc_enabled = ?"); values.append(req.plc_enabled)
    if req.plc_host is not None: fields.append("plc_host = ?"); values.append(req.plc_host)
    if req.plc_port is not None: fields.append("plc_port = ?"); values.append(req.plc_port)
    if req.plc_device is not None: fields.append("plc_device = ?"); values.append(req.plc_device)
    if req.plc_address is not None: fields.append("plc_address = ?"); values.append(req.plc_address)
    if req.is_active is not None: fields.append("is_active = ?"); values.append(req.is_active)
    if not fields: return {"message": "No fields to update"}
    values.append(machine_id)
    with get_db_connection() as conn:
        conn.cursor().execute(f"UPDATE {t_machines} SET {', '.join(fields)} WHERE id = ?", tuple(values))
    return {"message": "Machine updated successfully"}

@router.delete("/machines/{machine_id}")
def delete_machine(machine_id: int):
    t_machines = get_table_name("machines")
    with get_db_connection() as conn:
        conn.cursor().execute(f"DELETE FROM {t_machines} WHERE id = ?", (machine_id,))
    return {"message": "Machine deleted successfully"}


# 5. Cameras
@router.post("/cameras")
def create_camera(req: CameraCreate):
    t_cameras = get_table_name("cameras")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"""
        INSERT INTO {t_cameras} (machine_id, name, camera_ip, http_port, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (req.machine_id, req.name, req.camera_ip, req.http_port, req.rtsp_port, req.username, req.password, req.channel, req.rtsp_path, req.sub_rtsp_path, req.is_active))
        cursor.execute("SELECT @@IDENTITY")
        new_id = int(cursor.fetchone()[0])
    return {"id": new_id, "message": "Camera created successfully"}

@router.put("/cameras/{camera_id}")
def update_camera(camera_id: int, req: CameraUpdate):
    t_cameras = get_table_name("cameras")
    fields, values = [], []
    if req.machine_id is not None: fields.append("machine_id = ?"); values.append(req.machine_id)
    if req.name is not None: fields.append("name = ?"); values.append(req.name)
    if req.camera_ip is not None: fields.append("camera_ip = ?"); values.append(req.camera_ip)
    if req.http_port is not None: fields.append("http_port = ?"); values.append(req.http_port)
    if req.rtsp_port is not None: fields.append("rtsp_port = ?"); values.append(req.rtsp_port)
    if req.username is not None: fields.append("username = ?"); values.append(req.username)
    if req.password is not None: fields.append("password = ?"); values.append(req.password)
    if req.channel is not None: fields.append("channel = ?"); values.append(req.channel)
    if req.rtsp_path is not None: fields.append("rtsp_path = ?"); values.append(req.rtsp_path)
    if req.sub_rtsp_path is not None: fields.append("sub_rtsp_path = ?"); values.append(req.sub_rtsp_path)
    if req.is_active is not None: fields.append("is_active = ?"); values.append(req.is_active)
    if not fields: return {"message": "No fields to update"}
    values.append(camera_id)
    with get_db_connection() as conn:
        conn.cursor().execute(f"UPDATE {t_cameras} SET {', '.join(fields)} WHERE id = ?", tuple(values))
    # Update running worker if stream changed
    stream_pool.remove_worker(camera_id)
    return {"message": "Camera updated successfully"}

@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int):
    t_cameras = get_table_name("cameras")
    with get_db_connection() as conn:
        conn.cursor().execute(f"DELETE FROM {t_cameras} WHERE id = ?", (camera_id,))
    stream_pool.remove_worker(camera_id)
    return {"message": "Camera deleted successfully"}
