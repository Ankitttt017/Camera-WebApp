"""
Database initialization and migration script for Camera Hierarchy.
Creates tables:
- cam_plants
- cam_departments
- cam_lines
- cam_machines
- cam_cameras
And adds hierarchy columns to recordings table if not already present.
Auto-seeds the current active machine & camera.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
load_dotenv(BASE_DIR / '.env')
load_dotenv()

from backend.cpplus_helper import get_db_connection

def init_hierarchy_db():
    env = os.environ.get('ENVIRONMENT', 'development')
    prefix = os.environ.get('DB_TABLE_PREFIX_DEV', 'dev_') if env == 'development' else ''
    
    t_plants = f"{prefix}cam_plants"
    t_departments = f"{prefix}cam_departments"
    t_lines = f"{prefix}cam_lines"
    t_machines = f"{prefix}cam_machines"
    t_cameras = f"{prefix}cam_cameras"
    t_recordings = f"{prefix}recordings"
    
    print(f"[*] Initializing Hierarchy DB tables for environment: '{env}' (Prefix: '{prefix}')")
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Plants
        cursor.execute(f"""
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_plants}')
        BEGIN
            CREATE TABLE {t_plants} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                code NVARCHAR(50) NOT NULL UNIQUE,
                name NVARCHAR(100) NOT NULL,
                location NVARCHAR(200) NULL,
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE()
            );
            PRINT 'Created table {t_plants}';
        END
        """)
        
        # 2. Departments
        cursor.execute(f"""
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_departments}')
        BEGIN
            CREATE TABLE {t_departments} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                plant_id INT NOT NULL,
                code NVARCHAR(50) NOT NULL,
                name NVARCHAR(100) NOT NULL,
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE(),
                CONSTRAINT FK_{t_departments}_plant FOREIGN KEY (plant_id) REFERENCES {t_plants}(id) ON DELETE CASCADE
            );
            PRINT 'Created table {t_departments}';
        END
        """)
        
        # 3. Lines
        cursor.execute(f"""
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_lines}')
        BEGIN
            CREATE TABLE {t_lines} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                department_id INT NOT NULL,
                code NVARCHAR(50) NOT NULL,
                name NVARCHAR(100) NOT NULL,
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE(),
                CONSTRAINT FK_{t_lines}_dept FOREIGN KEY (department_id) REFERENCES {t_departments}(id) ON DELETE CASCADE
            );
            PRINT 'Created table {t_lines}';
        END
        """)
        
        # 4. Machines
        cursor.execute(f"""
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_machines}')
        BEGIN
            CREATE TABLE {t_machines} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                line_id INT NOT NULL,
                code NVARCHAR(50) NOT NULL,
                name NVARCHAR(100) NOT NULL,
                plc_enabled BIT DEFAULT 1,
                plc_host NVARCHAR(50) NULL,
                plc_port INT DEFAULT 5000,
                plc_device NVARCHAR(10) DEFAULT 'X',
                plc_address NVARCHAR(20) DEFAULT '4A',
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE(),
                CONSTRAINT FK_{t_machines}_line FOREIGN KEY (line_id) REFERENCES {t_lines}(id) ON DELETE CASCADE
            );
            PRINT 'Created table {t_machines}';
        END
        """)
        
        # 5. Cameras
        cursor.execute(f"""
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_cameras}')
        BEGIN
            CREATE TABLE {t_cameras} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                machine_id INT NOT NULL,
                name NVARCHAR(100) NOT NULL,
                camera_ip NVARCHAR(50) NOT NULL,
                http_port INT DEFAULT 80,
                rtsp_port INT DEFAULT 554,
                username NVARCHAR(50) DEFAULT 'admin',
                password NVARCHAR(100) DEFAULT 'Admin@123',
                channel INT DEFAULT 1,
                rtsp_path NVARCHAR(255) DEFAULT '/video/live?channel=1&subtype=0',
                sub_rtsp_path NVARCHAR(255) DEFAULT '/video/live?channel=1&subtype=1',
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE(),
                CONSTRAINT FK_{t_cameras}_machine FOREIGN KEY (machine_id) REFERENCES {t_machines}(id) ON DELETE CASCADE
            );
            PRINT 'Created table {t_cameras}';
        END
        """)
        
        # 6. Check columns in recordings table (add plant_id, machine_id, camera_id if missing)
        cursor.execute(f"""
        IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '{t_recordings}')
        BEGIN
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{t_recordings}' AND COLUMN_NAME = 'plant_id')
                ALTER TABLE {t_recordings} ADD plant_id INT NULL;
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{t_recordings}' AND COLUMN_NAME = 'department_id')
                ALTER TABLE {t_recordings} ADD department_id INT NULL;
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{t_recordings}' AND COLUMN_NAME = 'line_id')
                ALTER TABLE {t_recordings} ADD line_id INT NULL;
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{t_recordings}' AND COLUMN_NAME = 'machine_id')
                ALTER TABLE {t_recordings} ADD machine_id INT NULL;
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{t_recordings}' AND COLUMN_NAME = 'camera_id')
                ALTER TABLE {t_recordings} ADD camera_id INT NULL;
        END
        """)
        
        # 7. Seed current setup if empty
        cursor.execute(f"SELECT COUNT(*) FROM {t_plants}")
        plant_count = cursor.fetchone()[0]
        if plant_count == 0:
            print("[*] Seeding default hierarchy with current active machine & camera...")
            
            # Plant 1: Rico Bawal
            cursor.execute(f"INSERT INTO {t_plants} (code, name, location) VALUES ('1008', 'Rico Bawal', 'Rico Auto Industries Ltd - Bawal')")
            cursor.execute("SELECT @@IDENTITY")
            p1_id = int(cursor.fetchone()[0])
            
            # Plant 2: Rico Gurgaon
            cursor.execute(f"INSERT INTO {t_plants} (code, name, location) VALUES ('1002', 'Rico Gurgaon', 'Rico Auto Industries Ltd - Gurgaon')")
            
            # Dept: HPDC
            cursor.execute(f"INSERT INTO {t_departments} (plant_id, code, name) VALUES (?, 'HPDC', 'HPDC Casting')", (p1_id,))
            cursor.execute("SELECT @@IDENTITY")
            d1_id = int(cursor.fetchone()[0])
            
            # Dept: Machining
            cursor.execute(f"INSERT INTO {t_departments} (plant_id, code, name) VALUES (?, 'MACH', 'Machining')", (p1_id,))
            
            # Line: HPDC Medium Tonnage
            cursor.execute(f"INSERT INTO {t_lines} (department_id, code, name) VALUES (?, 'LINE_HPDC_MED', 'HPDC Medium Tonnage (600T-900T)')", (d1_id,))
            cursor.execute("SELECT @@IDENTITY")
            l1_id = int(cursor.fetchone()[0])
            
            # Machine: UBE-850T-02
            cursor.execute(f"""
            INSERT INTO {t_machines} (line_id, code, name, plc_enabled, plc_host, plc_port, plc_device, plc_address)
            VALUES (?, 'UBE-850T-02', 'UBE 850 T - 02', 1, '192.168.117.201', 5000, 'X', '4A')
            """, (l1_id,))
            cursor.execute("SELECT @@IDENTITY")
            m1_id = int(cursor.fetchone()[0])
            
            # Camera: Die Area Camera
            cursor.execute(f"""
            INSERT INTO {t_cameras} (machine_id, name, camera_ip, http_port, rtsp_port, username, password, channel, rtsp_path, sub_rtsp_path)
            VALUES (?, 'Die Area Camera', '192.168.119.205', 80, 554, 'admin', 'Admin@123', 1, '/video/live?channel=1&subtype=0', '/video/live?channel=1&subtype=1')
            """, (m1_id,))
            
            print("[SUCCESS] Default hierarchy seeded successfully!")
            
            # Backfill existing recordings with this camera and machine
            cursor.execute(f"""
            UPDATE {t_recordings}
            SET plant_id = ?, department_id = ?, line_id = ?, machine_id = ?
            WHERE camera_ip = '192.168.119.205' OR camera_ip IS NULL OR camera_ip = ''
            """, (p1_id, d1_id, l1_id, m1_id))
            print(f"[SUCCESS] Updated existing {t_recordings} records to link to default hierarchy.")
        else:
            print(f"[*] Hierarchy tables already exist ({plant_count} plants found). Skipping seed.")

if __name__ == '__main__':
    init_hierarchy_db()
