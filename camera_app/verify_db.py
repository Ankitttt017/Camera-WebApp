import sqlite3, os
db_path = "camera_app.db"
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")
    tables = [r[0] for r in cursor.fetchall()]
    print("SQLite DB tables:", tables)
    for t in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {t}")
        count = cursor.fetchone()[0]
        print(f"  {t}: {count} rows")
    conn.close()
else:
    print("DB not found")
