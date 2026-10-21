import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.db import get_db_connection, PrefixCursor

with get_db_connection() as conn:
    cur = PrefixCursor(conn.cursor())
    
    # 1. Check Gurgaon Plant (ID: 2)
    cur.execute("SELECT id, code, name FROM cam_plants WHERE id = 2")
    plant = cur.fetchone()
    if not plant:
        print("Error: Rico Gurgaon plant not found!")
        sys.exit(1)
    print(f"Found Plant: {dict(plant)}")
    
    # 2. Check or Create Department for Gurgaon
    cur.execute("SELECT id, name FROM cam_departments WHERE plant_id = 2 AND (name LIKE '%Casting%' OR name LIKE '%HPDC%')")
    d_row = cur.fetchone()
    if d_row:
        dept_id = d_row['id']
        print(f"Existing Dept in Gurgaon: ID {dept_id} - {d_row['name']}")
    else:
        cur.execute("INSERT INTO cam_departments (plant_id, code, name, is_active) VALUES (2, 'HPDC', 'HPDC Casting', 1)")
        cur.execute("SELECT @@IDENTITY AS id")
        dept_id = int(cur.fetchone()['id'])
        print(f"Created Dept 'HPDC Casting' (ID: {dept_id}) in Gurgaon")
        
    # 3. Check or Create Line for Gurgaon
    cur.execute("SELECT id, name FROM cam_lines WHERE department_id = ?", (dept_id,))
    l_row = cur.fetchone()
    if l_row:
        line_id = l_row['id']
        print(f"Existing Line in Gurgaon: ID {line_id} - {l_row['name']}")
    else:
        cur.execute("INSERT INTO cam_lines (department_id, code, name, is_active) VALUES (?, 'LINE_GGN_01', 'Die Casting Line 01', 1)", (dept_id,))
        cur.execute("SELECT @@IDENTITY AS id")
        line_id = int(cur.fetchone()['id'])
        print(f"Created Line 'Die Casting Line 01' (ID: {line_id}) in Gurgaon")
        
    # 4. Check or Create Machine for Gurgaon
    cur.execute("SELECT id, name FROM cam_machines WHERE line_id = ?", (line_id,))
    m_row = cur.fetchone()
    if m_row:
        machine_id = m_row['id']
        print(f"Existing Machine in Gurgaon: ID {machine_id} - {m_row['name']}")
    else:
        cur.execute("INSERT INTO cam_machines (line_id, code, name, plc_enabled, plc_host, plc_port, plc_device, plc_address, is_active) VALUES (?, 'DCM-GGN-01', 'Die Casting Machine GGN', 0, NULL, 5000, 'X', '4A', 1)", (line_id,))
        cur.execute("SELECT @@IDENTITY AS id")
        machine_id = int(cur.fetchone()['id'])
        print(f"Created Machine 'Die Casting Machine GGN' (ID: {machine_id}) in Gurgaon")
        
    # 5. Move Camera 3 (172.16.4.99) to Gurgaon Machine
    cur.execute("UPDATE cam_cameras SET machine_id = ?, name = 'Die Casing Area' WHERE id = 3", (machine_id,))
    print(f"Successfully moved Camera 3 (172.16.4.99) to Machine ID {machine_id} under Rico Gurgaon!")

print("\nVerification of all cameras:")
with get_db_connection() as conn:
    cur = PrefixCursor(conn.cursor())
    cur.execute("""
        SELECT 
            c.id, c.name AS cam_name, c.camera_ip,
            m.name AS machine_name,
            l.name AS line_name,
            d.name AS dept_name,
            p.name AS plant_name
        FROM cam_cameras c
        JOIN cam_machines m ON c.machine_id = m.id
        JOIN cam_lines l ON m.line_id = l.id
        JOIN cam_departments d ON l.department_id = d.id
        JOIN cam_plants p ON d.plant_id = p.id
    """)
    for r in cur.fetchall():
        print(dict(r))
