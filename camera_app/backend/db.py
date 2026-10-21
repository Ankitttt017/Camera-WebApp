import contextlib
import os
import re
import time
from pathlib import Path
from dotenv import load_dotenv
import pyodbc

APP_BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(APP_BASE_DIR / '.env')
load_dotenv()

@contextlib.contextmanager
def get_db_connection():
    env = os.environ.get("ENVIRONMENT", "development")
    server = os.environ.get("DB_SERVER", "192.168.100.46")
    port = os.environ.get("DB_PORT", "1433")
    db = os.environ.get("DB_NAME_PROD", "RICO_IOT") if env == "production" else os.environ.get("DB_NAME_DEV", "RICO_IOT")
    uid = os.environ.get("DB_USER", "automation")
    pwd = os.environ.get("DB_PASSWORD", "Autoiot@3869")
    drivers = [d for d in pyodbc.drivers() if "SQL Server" in d]
    driver = drivers[-1] if drivers else "ODBC Driver 17 for SQL Server"
    server_target = server if server.startswith("tcp:") else f"tcp:{server}"
    if "," not in server_target and port:
        server_target = f"{server_target},{port}"
    conn_str = f"DRIVER={{{driver}}};SERVER={server_target};DATABASE={db};UID={uid};PWD={pwd};TrustServerCertificate=yes;Encrypt=optional;Connection Timeout=10;"
    conn = None
    for attempt in range(3):
        try:
            conn = pyodbc.connect(conn_str, timeout=10)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(0.5)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


class PrefixCursor:
    def __init__(self, cursor):
        self.cursor = cursor
        env = os.environ.get('ENVIRONMENT', 'development')
        self.prefix = os.environ.get('DB_TABLE_PREFIX_DEV', 'dev_') if env == 'development' else ''
        
    def _rewrite_and_bind(self, query, args):
        q = query
        if self.prefix:
            q = re.sub(r'\brecordings\b', self.prefix + 'recordings', q)
            q = re.sub(r'\breason_options\b', self.prefix + 'reason_options', q)
            q = re.sub(r'\bidx_recordings_', 'idx_' + self.prefix + 'recordings_', q)
            q = re.sub(r'\bcam_plants\b', self.prefix + 'cam_plants', q)
            q = re.sub(r'\bcam_departments\b', self.prefix + 'cam_departments', q)
            q = re.sub(r'\bcam_lines\b', self.prefix + 'cam_lines', q)
            q = re.sub(r'\bcam_machines\b', self.prefix + 'cam_machines', q)
            q = re.sub(r'\bcam_cameras\b', self.prefix + 'cam_cameras', q)
            
        q = re.sub(r'LIMIT\s+:limit\s+OFFSET\s+:offset', 'OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY', q, flags=re.IGNORECASE)
        q = re.sub(r'LIMIT\s+(\?)\s+OFFSET\s+(\?)', r'OFFSET \2 ROWS FETCH NEXT \1 ROWS ONLY', q, flags=re.IGNORECASE)
        q = re.sub(r'LIMIT\s+(\d+)\b', r'OFFSET 0 ROWS FETCH NEXT \1 ROWS ONLY', q, flags=re.IGNORECASE)
        
        if args and isinstance(args[0], dict):
            params = args[0]
            param_names = []
            def repl(m):
                name = m.group(1)
                if name in params:
                    param_names.append(name)
                    return '?'
                return m.group(0)
            q = re.sub(r':([a-zA-Z_][a-zA-Z_0-9]*)', repl, q)
            new_args = tuple(params[name] for name in param_names)
            return q, new_args
        return q, args[0] if args else ()
        
    class RowAdapter:
        def __init__(self, description, row):
            self._row = row
            self._cols = [c[0] for c in description]
            self._dict = dict(zip(self._cols, row))
        def __getitem__(self, key):
            if isinstance(key, int): return self._row[key]
            return self._dict[key]
        def keys(self):
            return self._dict.keys()
        def __iter__(self):
            return iter(self._row)
        def get(self, key, default=None):
            return self._dict.get(key, default)

    def _wrap(self, row):
        if not row: return row
        if type(row).__name__ == 'RowAdapter': return row
        return self.RowAdapter(self.cursor.description, row)

    def execute(self, query, *args, **kwargs):
        q, new_args = self._rewrite_and_bind(query, args)
        if new_args:
            self.cursor.execute(q, new_args)
        else:
            self.cursor.execute(q)
        return self
        
    def executemany(self, query, *args, **kwargs):
        q, new_args = self._rewrite_and_bind(query, args)
        if new_args:
            self.cursor.executemany(q, new_args)
        else:
            self.cursor.executemany(q)
        return self

    def fetchone(self):
        row = self.cursor.fetchone()
        return self._wrap(row)

    def fetchall(self):
        rows = self.cursor.fetchall()
        return [self._wrap(r) for r in rows]

    @property
    def description(self):
        return self.cursor.description

    @property
    def rowcount(self):
        return self.cursor.rowcount
