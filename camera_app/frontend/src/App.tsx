import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  API_BASE,
  CameraSettings,
  PlcStatus,
  RecordingList,
  RecordingRecord,
  RecordingStats,
  RecordingStatus,
  buildCameraPayload,
  getJson,
  mjpegUrl,
  postJson,
  recordingFileUrl,
} from './api';

const DEFAULT_SETTINGS: CameraSettings = {
  ip: '192.168.119.205',
  http_port: 80,
  rtsp_port: 554,
  username: 'admin',
  password: 'Admin@123',
  channel: 1,
  storage_root: 'C:\\CPPLUS_RECORDINGS',
};

const PAGE_SIZE = 6;
const APP_TITLE = 'Rico Camera Capture';
const APP_MARK = 'RCC';

type Page = 'live' | 'saved';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString();
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return '-';
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  if (hours) return `${two(hours)}:${two(minutes)}:${two(sec)}`;
  return `${two(minutes)}:${two(sec)}`;
}

function formatSize(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (!value) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(size)} B` : `${size.toFixed(1)} ${units[unit]}`;
}

function clipStatus(record: RecordingRecord) {
  if (record.error) return 'Error';
  if (record.status) return record.status.replace(/_/g, ' ');
  return 'Saved';
}

function eventTypeLabel(value?: string | null) {
  if (value === 'breakdown') return 'Machine Breakdown';
  if (value === 'minor_stoppage') return 'Minor Stoppage';
  if (value === 'manual') return 'Manual';
  return 'Minor Stoppage';
}

function eventStart(record: RecordingRecord) {
  return record.event_started_at || record.started_at;
}

function eventEnd(record: RecordingRecord) {
  return record.event_ended_at || record.ended_at;
}

function eventDuration(record: RecordingRecord) {
  return record.event_duration_seconds ?? record.duration_seconds;
}

function secondsSince(value?: string | null, now = Date.now()) {
  if (!value) return null;
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, (now - started) / 1000);
}

function hasVideo(record: RecordingRecord) {
  return Boolean(record.file_path && !record.file_path.startsWith('event://') && record.recording_engine !== 'event');
}

function emptyStats(): RecordingStats {
  return {
    today: {
      total_events: 0,
      minor_stoppage_count: 0,
      breakdown_count: 0,
      recorded_duration_seconds: 0,
      breakdown_duration_seconds: 0,
      storage_used: 0,
    },
    storage: {
      today: 0,
      week: 0,
      month: 0,
      total: 0,
      video_count: 0,
      average_file_size: 0,
    },
    breakdown: {
      average_duration_seconds: 0,
      longest_duration_seconds: 0,
    },
    latest_event: null,
    trend: [],
    top_heavy_videos: [],
    machines: [],
  };
}

function KpiCards({ stats }: { stats: RecordingStats }) {
  const items = [
    ['Events', stats.today.total_events],
    ['Minor', stats.today.minor_stoppage_count],
    ['Breakdown', stats.today.breakdown_count],
    ['Recorded', formatDuration(stats.today.recorded_duration_seconds)],
    ['Breakdown time', formatDuration(stats.today.breakdown_duration_seconds)],
    ['Today storage', formatSize(stats.storage.today)],
    ['Total storage', formatSize(stats.storage.total)],
    ['Avg breakdown', formatDuration(stats.breakdown.average_duration_seconds)],
    ['Longest', formatDuration(stats.breakdown.longest_duration_seconds)],
    ['Latest', stats.latest_event ? eventTypeLabel(stats.latest_event.event_type) : '-'],
  ];
  return (
    <div className="kpi-grid">
      {items.map(([label, value]) => (
        <div className="kpi-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function friendlyError(exc: unknown) {
  const message = exc instanceof Error ? exc.message : String(exc);
  const normalized = message.trim().toLowerCase();
  if (!normalized || normalized === 'not found' || normalized === '404' || normalized === '404 not found') {
    return '';
  }
  if (message === 'Failed to fetch') {
    return 'Helper API is not running on 127.0.0.1:8010. Start the helper and refresh.';
  }
  if (message.includes('RTSP') || message.includes('Unauthorized') || message.includes('stream open')) {
    return 'Camera stream connect nahi ho pa raha. Live preview chal raha ho to ek moment wait karke retry karein; camera login/RTSP access bhi check karein.';
  }
  return message;
}

function friendlyRecordingError(message?: string | null) {
  if (!message) return '';
  if (message.includes('RTSP') || message.includes('Unauthorized') || message.includes('stream open')) {
    return 'Recording stream connect nahi ho pa raha. Camera access check karke retry karein.';
  }
  return 'Recording complete nahi ho payi. Settings aur camera connection check karein.';
}

type IconName = 'live' | 'archive' | 'record' | 'settings' | 'logout' | 'camera' | 'maximize' | 'minimize' | 'fit' | 'audio' | 'storage' | 'activity';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    live: 'M4 6.5h16v11H4z M9 20h6 M12 17.5V20',
    archive: 'M5 7h14v12H5z M8 4h8v3 M8 11h8',
    record: 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z M12 3v3 M12 18v3 M4.2 6.2l2.1 2.1 M17.7 15.7l2.1 2.1 M3 12h3 M18 12h3 M4.2 17.8l2.1-2.1 M17.7 8.3l2.1-2.1',
    logout: 'M10 5H5v14h5 M14 8l4 4-4 4 M8 12h10',
    camera: 'M4 7h11v10H4z M15 10l5-3v10l-5-3z',
    maximize: 'M5 10V5h5 M14 5h5v5 M19 14v5h-5 M10 19H5v-5',
    minimize: 'M6 12h12',
    fit: 'M8 5H5v3 M16 5h3v3 M19 16v3h-3 M8 19H5v-3',
    audio: 'M5 10v4h3l4 3V7L8 10z M16 9a4 4 0 0 1 0 6',
    storage: 'M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2z M5 6v6c0 1.1 3.1 2 7 2s7-.9 7-2V6 M5 12v6c0 1.1 3.1 2 7 2s7-.9 7-2v-6',
    activity: 'M4 12h4l2-6 4 12 2-6h4',
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (username === 'admin' && password === 'Admin@123') {
      onLogin();
      return;
    }
    setError('Invalid username or password.');
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-intro">
          <div className="brand-mark large">{APP_MARK}</div>
          <div>
            <div className="eyebrow">Operator Workstation</div>
            <h1>{APP_TITLE}</h1>
            <p>Live camera monitoring, gate-triggered capture, and saved video review for the production floor.</p>
          </div>
          <div className="login-meta">
            <span>Live view</span>
            <span>Gate trigger</span>
            <span>Recording archive</span>
          </div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <div>
            <div className="eyebrow">Secure sign in</div>
            <h2>Access Console</h2>
          </div>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary-button" type="submit">Sign In</button>
          <p className="login-help">Default operator login: admin / Admin@123</p>
        </form>
      </section>
    </main>
  );
}

function Sidebar({
  page,
  setPage,
  settings,
  setSettings,
  recording,
  plc,
  onStartRecording,
  onLogout,
}: {
  page: Page;
  setPage: (page: Page) => void;
  settings: CameraSettings;
  setSettings: (settings: CameraSettings) => void;
  recording: RecordingStatus;
  plc: PlcStatus;
  onStartRecording: () => void;
  onLogout: () => void;
}) {
  const update = <K extends keyof CameraSettings>(key: K, value: CameraSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-lockup">
          <div className="brand-mark small">{APP_MARK}</div>
          <div>
            <strong>Rico Capture</strong>
            <span>Camera management</span>
          </div>
        </div>
      </div>

      <div className="stream-pill">
        <span aria-hidden="true"></span>
        <strong>{recording.running ? 'Recording now' : 'Stream active'}</strong>
        <small>CH {settings.channel}</small>
      </div>

      <nav>
        <span className="nav-label">Monitor</span>
        <button className={page === 'live' ? 'active' : ''} onClick={() => setPage('live')}>
          <span className="nav-icon"><Icon name="live" /></span>
          Live View
        </button>
        <button className={page === 'saved' ? 'active' : ''} onClick={() => setPage('saved')}>
          <span className="nav-icon"><Icon name="archive" /></span>
          My Report
          <span className="nav-count">{recording.running ? 'REC' : 'report'}</span>
        </button>
        <span className="nav-label">Recording</span>
        <button disabled={recording.running} onClick={onStartRecording}>
          <span className="nav-icon"><Icon name="record" /></span>
          Record Now
        </button>
        <span className="nav-label">System</span>
        <details className="settings-menu">
          <summary><span className="nav-icon"><Icon name="settings" /></span> Settings</summary>
          <div className="dropdown-body">
            <label>
              Camera IP
              <input value={settings.ip} onChange={(event) => update('ip', event.target.value)} />
            </label>
            <div className="field-grid">
              <label>
                HTTP
                <input type="number" value={settings.http_port} onChange={(event) => update('http_port', Number(event.target.value))} />
              </label>
              <label>
                RTSP
                <input type="number" value={settings.rtsp_port} onChange={(event) => update('rtsp_port', Number(event.target.value))} />
              </label>
            </div>
            <label>
              Channel
              <input type="number" min="1" value={settings.channel} onChange={(event) => update('channel', Number(event.target.value))} />
            </label>
            <label>
              Recording folder
              <input value={settings.storage_root} onChange={(event) => update('storage_root', event.target.value)} />
            </label>
            <div className="settings-status">
              <span><Icon name="camera" /> Camera <strong>{settings.ip}</strong></span>
              <span><Icon name="activity" /> Frames <strong>{recording.frames || 0}</strong></span>
              <span><Icon name="record" /> Record <strong>{recording.running ? 'Active' : 'Idle'}</strong></span>
              <span><Icon name="audio" /> Audio <strong>{recording.audio?.includes('enabled') ? 'On' : 'Off'}</strong></span>
              <span><Icon name="storage" /> Storage <strong>{settings.storage_root}</strong></span>
              <span><Icon name="activity" /> Clip limit <strong>5 minutes</strong></span>
            </div>
          </div>
        </details>
      </nav>

      <div className="auto-card">
        <div className="nav-label">Auto-trigger (PLC)</div>
        <div className="trigger-panel">
          <strong><span aria-hidden="true"></span> Trigger: {plc.running ? 'Active' : 'Idle'}</strong>
          <p>X4A OFF - Record</p>
          <p>X4A ON - Stop & Save</p>
          <p>Max clip: 5 min</p>
          {plc.last_error && <p className="muted-error">{plc.last_error}</p>}
        </div>
      </div>

      <div className="sidebar-footer">
        <div>
          <strong>Operator</strong>
          <span>{settings.ip} : {settings.rtsp_port}</span>
        </div>
        <button className="logout-button" onClick={onLogout}><Icon name="logout" /> Logout</button>
      </div>
    </aside>
  );
}

function TopBar({ page, recording, settings }: { page: Page; recording: RecordingStatus; settings: CameraSettings }) {
  return (
    <div className="topbar">
      <div>
        <strong>{page === 'live' ? 'Live View' : 'My Report'}</strong>
      </div>
      <div className="topbar-actions">
        <span className="topbar-cta"><i></i> Stream on</span>
        <span className="channel-chip">CH {settings.channel}</span>
        {recording.running && <span className="record-dot">REC</span>}
      </div>
    </div>
  );
}

function LivePage({
  settings,
  recording,
  online,
  plc,
}: {
  settings: CameraSettings;
  recording: RecordingStatus;
  online: boolean;
  plc: PlcStatus;
}) {
  const liveUrl = useMemo(() => mjpegUrl(settings), [settings]);
  const liveFrameRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [fillFrame, setFillFrame] = useState(true);

  async function toggleFullscreen() {
    const target = liveFrameRef.current;
    if (!target) return;
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }
    await target.requestFullscreen();
  }

  const liveEventType = recording.event_type
    || plc.current_event_type
    || null;
  const activeEventType = recording.running || plc.gate_open ? eventTypeLabel(liveEventType) : '';
  const activeIsBreakdown = liveEventType === 'breakdown' || activeEventType === 'Machine Breakdown';

  return (
    <section className="workbench live-workbench">
      <div className="feed-column">
        <div className={[
          'live-frame',
          compact ? 'compact' : '',
          fillFrame ? 'fill' : 'fit',
        ].filter(Boolean).join(' ')} ref={liveFrameRef}>
          <div className="camera-status-strip">
            <span className={online ? 'mini-pill good' : 'mini-pill bad'}><Icon name="camera" /> {online ? 'LIVE' : 'OFFLINE'}</span>
            {recording.running && <span className="mini-pill rec blink"><Icon name="record" /> REC</span>}
            {activeEventType && <span className={activeIsBreakdown ? 'mini-pill breakdown' : 'mini-pill event'}>{activeEventType}</span>}
          </div>
          <div className="live-frame-actions">
            <button type="button" title={compact ? 'Restore camera view' : 'Minimize camera view'} onClick={() => setCompact((value) => !value)}>
              <Icon name={compact ? 'maximize' : 'minimize'} />
            </button>
            <button type="button" title={fillFrame ? 'Fit camera frame' : 'Fill camera frame'} onClick={() => setFillFrame((value) => !value)}>
              <Icon name="fit" />
            </button>
            <button type="button" title="Fullscreen" onClick={toggleFullscreen}><Icon name="maximize" /></button>
          </div>
          <img src={liveUrl} alt="Live camera feed" />
        </div>
        {recording.error && recording.running && <div className="error-banner">Recording status: {friendlyRecordingError(recording.error)}</div>}
      </div>
    </section>
  );
}

function SavedPage({
  settings,
  refreshToken,
  stats,
  plc,
}: {
  settings: CameraSettings;
  refreshToken: number;
  stats: RecordingStats;
  plc: PlcStatus;
}) {
  const [page, setPage] = useState(1);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [fromDate, setFromDate] = useState(todayInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [category, setCategory] = useState('all');
  const [list, setList] = useState<RecordingList>({ total: 0, page: 1, page_size: PAGE_SIZE, records: [] });
  const [latest, setLatest] = useState<RecordingRecord | null>(null);
  const [selected, setSelected] = useState<RecordingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const playerRef = useRef<HTMLVideoElement | null>(null);

  async function load(refreshIndex = false) {
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, string | number | boolean> = {
        storage_root: settings.storage_root,
        page,
        page_size: PAGE_SIZE,
      };
      if (filterEnabled) {
        payload.start_at = `${fromDate}T00:00:00`;
        payload.end_at = `${toDate}T23:59:59`;
      }
      if (category !== 'all') {
        payload.event_type = category;
      }
      const endpoint = refreshIndex ? '/recording-index/scan' : '/recording-index/list';
      const data = await postJson<RecordingList>(endpoint, payload);
      const records = (data.records || []).slice(0, PAGE_SIZE);
      setList({ ...data, records });
      setSelected((current) => {
        if (current && records.some((record) => record.file_path === current.file_path)) return current;
        return records[0] || null;
      });

      const latestData = await postJson<RecordingList>('/recording-index/list', {
        storage_root: settings.storage_root,
        page: 1,
        page_size: 1,
      });
      setLatest(latestData.records?.[0] || null);
    } catch (exc) {
      setError(friendlyError(exc));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterEnabled, fromDate, toDate, category, settings.storage_root, refreshToken, stats.latest_event?.started_at]);

  useEffect(() => {
    if (!plc.gate_open) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [plc.gate_open]);

  const totalPages = Math.max(1, Math.ceil((list.total || 0) / PAGE_SIZE));
  const selectedVideoUrl = useMemo(
    () => selected && hasVideo(selected)
      ? `${recordingFileUrl(settings.storage_root, selected.file_path)}&v=${encodeURIComponent(String(selected.file_size || selected.updated_at || selected.ended_at || '0'))}`
      : '',
    [selected, settings.storage_root],
  );

  useEffect(() => {
    if (!selectedVideoUrl || !playerRef.current) return;
    playerRef.current.pause();
    playerRef.current.load();
  }, [selectedVideoUrl]);
  const latestOpenBreakdownPath = stats.latest_event?.event_type === 'breakdown' ? stats.latest_event.file_path : latest?.event_type === 'breakdown' ? latest.file_path : null;

  function isOpenBreakdown(record: RecordingRecord) {
    return Boolean(plc.gate_open && record.event_type === 'breakdown' && latestOpenBreakdownPath && record.file_path === latestOpenBreakdownPath);
  }

  function liveBreakdownDuration(record: RecordingRecord) {
    if (isOpenBreakdown(record)) {
      const elapsed = secondsSince(record.event_started_at || stats.latest_event?.event_started_at || record.started_at, nowTick);
      if (elapsed !== null) return elapsed;
    }
    return eventDuration(record);
  }

  function liveEventEnd(record: RecordingRecord) {
    return isOpenBreakdown(record) ? 'Running' : formatDateTime(eventEnd(record));
  }

  function liveStatus(record: RecordingRecord, isSelected: boolean) {
    if (isOpenBreakdown(record)) return 'Running';
    return isSelected ? 'Playing' : clipStatus(record);
  }

  return (
    <section className="workbench saved-workbench">
      <div className="library-column">
        <KpiCards stats={stats} />

        {latest && (
          <div className="latest-card">
            <div className="section-kicker">Latest event</div>
            <strong>{latest.file_name}</strong>
            <div className="latest-grid">
              <span><small>Start</small>{formatDateTime(latest.started_at)}</span>
              <span><small>Duration</small>{formatDuration(latest.duration_seconds)}</span>
              {latest.event_type === 'breakdown' && <span><small>Breakdown</small>{formatDuration(liveBreakdownDuration(latest))}</span>}
              <span><small>Type</small>{eventTypeLabel(latest.event_type)}</span>
            </div>
            <a className="download-button subtle" href={recordingFileUrl(settings.storage_root, latest.file_path, true)}><Icon name="storage" /> Save</a>
          </div>
        )}

        <div className="library-header">
          <div>
            <h2>Event Report</h2>
            <span>{list.total} events</span>
          </div>
          <button onClick={() => load(true)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>

        <div className="filter-card compact-filter">
          <label className="check-row">
            <input type="checkbox" checked={filterEnabled} onChange={(event) => { setFilterEnabled(event.target.checked); setPage(1); }} />
            Date filter
          </label>
          <label>
            From
            <input type="date" disabled={!filterEnabled} value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
          </label>
          <label>
            To
            <input type="date" disabled={!filterEnabled} value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="minor_stoppage">Minor Stoppage</option>
              <option value="breakdown">Machine Breakdown</option>
            </select>
          </label>
        </div>

        <div className="storage-analytics">
          <div>
            <span>Today</span>
            <strong>{formatSize(stats.storage.today)}</strong>
          </div>
          <div>
            <span>This Week</span>
            <strong>{formatSize(stats.storage.week)}</strong>
          </div>
          <div>
            <span>This Month</span>
            <strong>{formatSize(stats.storage.month)}</strong>
          </div>
          <div>
            <span>Videos</span>
            <strong>{stats.storage.video_count}</strong>
          </div>
          <div>
            <span>Avg File</span>
            <strong>{formatSize(stats.storage.average_file_size)}</strong>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!loading && list.records.length === 0 && (
          <div className="empty-state">
            <strong>No events found</strong>
            <span>Refresh the report after a gate event, or adjust the date/category filter.</span>
          </div>
        )}

        {list.records.length > 0 && <div className="record-list">
          <div className="record-list-head">
            <span>Recording Time</span>
            <span>Start Time</span>
            <span>End Time</span>
            <span>Video Duration</span>
            <span>Breakdown Duration</span>
            <span>Category</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {list.records.map((record, index) => {
            const isSelected = selected?.file_path === record.file_path;
            const status = liveStatus(record, isSelected);
            const videoAvailable = hasVideo(record);
            return (
              <article className={isSelected ? 'record-row selected' : 'record-row'} key={record.file_path}>
                <button className="record-time" onClick={() => setSelected({ ...record })}>
                  <strong>{formatDateTime(record.started_at)}</strong>
                  <span>{record.file_name}</span>
                </button>
                <span className="record-duration">{formatDateTime(eventStart(record))}</span>
                <span className="record-duration">{liveEventEnd(record)}</span>
                <span className="record-duration">{formatDuration(record.duration_seconds)}</span>
                <span className="record-duration">{record.event_type === 'breakdown' ? formatDuration(liveBreakdownDuration(record)) : '-'}</span>
                <span className={record.event_type === 'breakdown' ? 'status-badge bad' : 'status-badge neutral'}>{eventTypeLabel(record.event_type)}</span>
                <span className={record.error ? 'status-badge bad' : 'status-badge good'}>{status}</span>
                <div className="row-actions">
                  {videoAvailable ? (
                    <>
                      <button disabled={isSelected} onClick={() => setSelected({ ...record })}>{isSelected ? 'Playing' : 'Play'}</button>
                      <a className="download-button" href={recordingFileUrl(settings.storage_root, record.file_path, true)}><Icon name="storage" /> Download</a>
                    </>
                  ) : (
                    <span className="no-video-note">No video</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>}

        {list.records.length > 0 && <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </div>

      <aside className="right-rail playback-rail">
        {selected && hasVideo(selected) ? (
          <>
            <video
              ref={playerRef}
              key={selected.file_path}
              className="record-player"
              src={selectedVideoUrl}
              controls
              preload="metadata"
              onLoadedMetadata={() => setError('')}
              onError={() => setError('Selected video load nahi ho paya. Download se file verify karein.')}
            />
            <strong className="selected-name">{selected.file_name}</strong>
            <a className="download-button rail-save" href={recordingFileUrl(settings.storage_root, selected.file_path, true)}><Icon name="storage" /> Save</a>
            <div className="rail-section">
              <dl className="detail-list">
                <dt>Date</dt><dd>{formatDateTime(selected.started_at).split(',')[0]}</dd>
                <dt>Start</dt><dd>{formatDateTime(eventStart(selected))}</dd>
                <dt>End</dt><dd>{liveEventEnd(selected)}</dd>
                <dt>Video duration</dt><dd>{formatDuration(selected.duration_seconds)}</dd>
                <dt>Breakdown duration</dt><dd>{selected.event_type === 'breakdown' ? formatDuration(liveBreakdownDuration(selected)) : '-'}</dd>
                <dt>Category</dt><dd>{eventTypeLabel(selected.event_type)}</dd>
                <dt>File size</dt><dd>{formatSize(selected.file_size)}</dd>
                <dt>Channel</dt><dd>CH {settings.channel}</dd>
                <dt>RTSP port</dt><dd>{settings.rtsp_port}</dd>
                <dt>Audio</dt><dd>{selected.audio || 'Video only'}</dd>
                <dt>Storage</dt><dd>{settings.storage_root}</dd>
              </dl>
            </div>
          </>
        ) : selected ? (
          <div className="empty-state">
            <strong>{eventTypeLabel(selected.event_type)}</strong>
            <span>No video available for this event.</span>
          </div>
        ) : (
          <div className="empty-state">
            <strong>No clip selected</strong>
            <span>Choose an event from the report.</span>
          </div>
        )}
      </aside>
    </section>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem('mer_auth') === 'true');
  const [page, setPage] = useState<Page>('live');
  const [settings, setSettings] = useState<CameraSettings>(DEFAULT_SETTINGS);
  const [recording, setRecording] = useState<RecordingStatus>({ running: false, frames: 0 });
  const [plc, setPlc] = useState<PlcStatus>({ running: false });
  const [stats, setStats] = useState<RecordingStats>(() => emptyStats());
  const [cameraOnline, setCameraOnline] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  async function refreshStatus() {
    try {
      const [recordingStatus, plcStatus] = await Promise.all([
        getJson<RecordingStatus>('/recording/status'),
        getJson<PlcStatus>('/plc-monitor/status'),
      ]);
      setRecording(recordingStatus);
      setPlc(plcStatus);
      setMessage('');
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function verifyCamera() {
    try {
      await postJson<{ ok: boolean }>('/verify', buildCameraPayload(settings));
      setCameraOnline(true);
    } catch {
      setCameraOnline(false);
    }
  }

  async function refreshStats() {
    try {
      const data = await postJson<RecordingStats>('/recording-index/stats', {
        storage_root: settings.storage_root,
        page: 1,
        page_size: 1,
      });
      setStats(data);
      setMessage('');
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  useEffect(() => {
    if (!authenticated) return;
    refreshStatus();
    refreshStats();
    const timer = window.setInterval(refreshStatus, 3000);
    const statsTimer = window.setInterval(refreshStats, 15000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(statsTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    verifyCamera();
    const timer = window.setInterval(verifyCamera, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, settings.ip, settings.http_port, settings.username, settings.password]);

  async function startRecording() {
    setMessage('');
    try {
      const status = await postJson<RecordingStatus>('/recording/start', buildCameraPayload(settings));
      setRecording(status);
      refreshStats();
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function stopRecording() {
    setMessage('');
    try {
      const status = await postJson<RecordingStatus>('/recording/stop', {});
      setRecording(status);
      setRefreshToken((value) => value + 1);
      refreshStats();
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  if (!authenticated) {
    return <Login onLogin={() => { localStorage.setItem('mer_auth', 'true'); setAuthenticated(true); }} />;
  }

  function logout() {
    localStorage.removeItem('mer_auth');
    setAuthenticated(false);
    setPage('live');
    setMessage('');
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        settings={settings}
        setSettings={setSettings}
        recording={recording}
        plc={plc}
        onStartRecording={startRecording}
        onLogout={logout}
      />
      <main className="content">
        <TopBar page={page} recording={recording} settings={settings} />
        {message && page !== 'live' && <div className="error-banner">{message}</div>}
        {page === 'live' ? (
          <LivePage
            settings={settings}
            recording={recording}
            online={cameraOnline}
            plc={plc}
          />
        ) : (
          <SavedPage settings={settings} refreshToken={refreshToken} stats={stats} plc={plc} />
        )}
        <footer>
          <strong>{APP_TITLE}</strong>
          <span>Storage: {settings.storage_root} | Helper: {API_BASE}</span>
        </footer>
      </main>
    </div>
  );
}
