import os
import sqlite3
import pyodbc
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

def get_sql_server_connection():
    env = os.environ.get("ENVIRONMENT", "development")
    server = os.environ.get("DB_SERVER", "192.168.100.46")
    db = os.environ.get("DB_NAME_PROD", "RICO_IOT") if env == "production" else os.environ.get("DB_NAME_DEV", "RICO_IOT")
    uid = os.environ.get("DB_USER", "automation")
    pwd = os.environ.get("DB_PASSWORD", "Autoiot@3869")
    
    drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
    driver = drivers[-1] if drivers else "ODBC Driver 17 for SQL Server"
    
    conn_str = f"DRIVER={{{driver}}};SERVER={server};DATABASE={db};UID={uid};PWD={pwd};TrustServerCertificate=yes;"
    return pyodbc.connect(conn_str)

def migrate_historical_data():
    print("Starting Data Migration to SQL Server...")
    
    # 1. Connect to SQL Server
    try:
        sql_conn = get_sql_server_connection()
        sql_cursor = sql_conn.cursor()
        print("✅ Successfully connected to SQL Server.")
    except Exception as e:
        print("❌ Error connecting to SQL Server:", e)
        return

    # Determine which table we are writing to based on the environment
    env = os.environ.get('ENVIRONMENT', 'development')
    prefix = os.environ.get('DB_TABLE_PREFIX_DEV', 'dev_') if env == 'development' else ''
    target_table = f"{prefix}recordings"
    print(f"Target SQL Server Table: {target_table}")

    # 2. Connect to the Live SQLite Database
    recordings_root = Path(os.getenv('RECORDINGS_ROOT', BASE_DIR / 'recordings'))
    sqlite_db_path = recordings_root / 'recording_index.db'
    
    if not sqlite_db_path.exists():
        print(f"❌ SQLite database not found at {sqlite_db_path}. No historical data to migrate.")
        return
        
    print(f"✅ Found SQLite Database at: {sqlite_db_path}")
    
    sqlite_conn = sqlite3.connect(sqlite_db_path)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()
    
    # 3. Read data from SQLite
    try:
        rows = sqlite_cursor.execute("SELECT * FROM recordings").fetchall()
        print(f"🔍 Found {len(rows)} historical records in SQLite.")
    except Exception as e:
        print("❌ Error reading from SQLite:", e)
        return
        
    if not rows:
        print("No records to migrate.")
        return

    # 4. Insert into SQL Server
    try:
        sql_cursor.execute(f"SET IDENTITY_INSERT {target_table} ON")
    except Exception as e:
        print(f"⚠️ Could not set IDENTITY_INSERT ON for {target_table} (It may not be needed or you lack permissions):", e)
        
    columns = list(rows[0].keys())
    cols_str = ", ".join(columns)
    placeholders = ", ".join(["?"] * len(columns))
    insert_query = f"INSERT INTO {target_table} ({cols_str}) VALUES ({placeholders})"
    
    migrated_count = 0
    skipped_count = 0
    
    for row in rows:
        try:
            sql_cursor.execute(insert_query, tuple(row))
            migrated_count += 1
        except pyodbc.IntegrityError:
            # Usually means the ID already exists (duplicate)
            skipped_count += 1
        except Exception as e:
            print(f"⚠️ Error migrating row ID {row['id']}:", e)
            skipped_count += 1

    sql_conn.commit()
    print("--------------------------------------------------")
    print(f"🎉 Migration Complete!")
    print(f"   Successfully Migrated: {migrated_count} records")
    print(f"   Skipped (Duplicates/Errors): {skipped_count} records")
    print("--------------------------------------------------")

if __name__ == "__main__":
    migrate_historical_data()
