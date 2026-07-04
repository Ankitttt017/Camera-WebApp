import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  API_BASE,
  CameraSettings,
  PlcStatus,
  RecordingList,
  RecordingRecord,
  RecordingStats,
  RecordingStatus,
  audioUrl,
  buildCameraPayload,
  buildPlcPayload,
  getJson,
  mjpegUrl,
  postJson,
  recordingExportUrl,
  recordingFileUrl,
  PlcTestResult,
} from './api';

const DEFAULT_PUBLIC_HELPER_URL = 'http://172.16.4.242:8010';
const LEGACY_PUBLIC_HELPER_URLS = new Set([
  'http://192.168.119.205:8010',
]);

const DEFAULT_SETTINGS: CameraSettings = {
  ip: '192.168.119.205',
  http_port: 80,
  rtsp_port: 554,
  username: 'admin',
  password: 'Admin@123',
  channel: 1,
  storage_root: 'D:\\CPPLUS_RECORDINGS',
  public_helper_url: DEFAULT_PUBLIC_HELPER_URL,
  capture_video: true,
  capture_breakdown_video: true,
  plc_host: '192.168.117.201',
  plc_port: 5003,
  plc_device: 'X',
  plc_address: '4A',
  max_record_seconds: 300,
};
const SETTINGS_STORAGE_KEY = 'rico-camera-settings';

const PAGE_SIZE = 10;
const APP_TITLE = 'RicoDigiTech';
const APP_MARK = 'RCC';
const RICO_LOGO_SRC = '/rico-logo.png';

type Page = 'live' | 'saved';

function loadSavedSettings(): CameraSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    if (!saved.public_helper_url || LEGACY_PUBLIC_HELPER_URLS.has(String(saved.public_helper_url).trim())) {
      saved.public_helper_url = DEFAULT_PUBLIC_HELPER_URL;
    }
    if (Number(saved.max_record_seconds) > 3600 || Number(saved.max_record_seconds) < 1) {
      saved.max_record_seconds = 300;
    }
    return saved;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString();
}

function formatTimeOnly(value?: string | null) {
  if (!value) return '-';
  if (value === 'Running') return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const parts = value.replace('T', ' ').split(' ');
    return parts[1] || value;
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  if (value === 'breakdown') return 'Breakdown';
  if (value === 'minor_stoppage') return 'Minor Stoppage';
  if (value === 'self_capture' || value === 'manual') return 'Self Capture';
  return 'Minor Stoppage';
}

function machineStateLabel(value?: string | null) {
  if (value === 'running') return 'Machine Running';
  return eventTypeLabel(value);
}

function normalizeGateEventType(value?: string | null) {
  return value === 'breakdown' || value === 'minor_stoppage' ? value : null;
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

function isRecordingOpen(record: RecordingRecord) {
  const status = String(record.status || '').toLowerCase();
  return status === 'running' || (!record.ended_at && hasVideo(record));
}

function videoReady(record: RecordingRecord) {
  return hasVideo(record) && !isRecordingOpen(record);
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

function statsFromRecords(records: RecordingRecord[]): RecordingStats {
  const totalEvents = records.length;
  const minorCount = records.filter((record) => record.event_type !== 'breakdown').length;
  const breakdownCount = records.filter((record) => record.event_type === 'breakdown').length;
  const recordedDuration = records.reduce((sum, record) => sum + Number(eventDuration(record) || 0), 0);
  const breakdownDuration = records
    .filter((record) => record.event_type === 'breakdown')
    .reduce((sum, record) => sum + Number(eventDuration(record) || 0), 0);
  const storageUsed = records.reduce((sum, record) => sum + Number(record.file_size || 0), 0);
  const breakdownDurations = records
    .filter((record) => record.event_type === 'breakdown')
    .map((record) => Number(eventDuration(record) || 0));
  return {
    ...emptyStats(),
    today: {
      total_events: totalEvents,
      minor_stoppage_count: minorCount,
      breakdown_count: breakdownCount,
      recorded_duration_seconds: recordedDuration,
      breakdown_duration_seconds: breakdownDuration,
      storage_used: storageUsed,
    },
    storage: {
      today: storageUsed,
      week: storageUsed,
      month: storageUsed,
      total: storageUsed,
      video_count: totalEvents,
      average_file_size: totalEvents ? storageUsed / totalEvents : 0,
    },
    breakdown: {
      average_duration_seconds: breakdownDurations.length
        ? breakdownDurations.reduce((sum, value) => sum + value, 0) / breakdownDurations.length
        : 0,
      longest_duration_seconds: Math.max(0, ...breakdownDurations),
    },
    latest_event: records[0] || null,
  };
}

function KpiCards({ stats }: { stats: RecordingStats }) {
  const averageDuration = stats.today.total_events
    ? stats.today.recorded_duration_seconds / stats.today.total_events
    : 0;
  const items = [
    ['Total Events', stats.today.total_events],
    ['Minor Stoppage (< 5 min)', stats.today.minor_stoppage_count],
    ['Breakdown (> 5 min)', stats.today.breakdown_count],
    ['Storage Used', formatSize(stats.today.storage_used)],
    ['Avg Duration', formatDuration(averageDuration)],
  ];
  return (
    <div className="kpi-grid">
      {items.map(([label, value], index) => (
        <div className={`kpi-card kpi-card-${index + 1}`} key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function todayInputValue() {
  return dateInputValue(new Date());
}

function dateInputValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

type ReportDatePreset = 'today' | 'yesterday' | 'last_7' | 'last_15' | 'custom' | 'all';
type ReportFilters = {
  datePreset: ReportDatePreset;
  fromDate: string;
  toDate: string;
  category: string;
};

function presetDateRange(preset: ReportDatePreset, fromDate: string, toDate: string) {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);
  if (preset === 'all') return null;
  if (preset === 'custom') return { fromDate, toDate };
  if (preset === 'yesterday') {
    start.setDate(today.getDate() - 1);
    end.setDate(today.getDate() - 1);
  }
  if (preset === 'last_7') {
    start.setDate(today.getDate() - 6);
  }
  if (preset === 'last_15') {
    start.setDate(today.getDate() - 14);
  }
  return { fromDate: dateInputValue(start), toDate: dateInputValue(end) };
}

function reportDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function reportPresetLabel(value: ReportDatePreset) {
  if (value === 'today') return 'Today';
  if (value === 'yesterday') return 'Yesterday';
  if (value === 'last_7') return 'Last 7 Days';
  if (value === 'last_15') return 'Last 15 Days';
  if (value === 'custom') return 'Custom Range';
  return 'All Time';
}

function reportCategoryLabel(value: string) {
  if (value === 'breakdown') return 'Breakdown (> 5 min)';
  if (value === 'minor_stoppage') return 'Minor Stoppage (< 5 min)';
  return 'All Categories';
}

function reportRangeSummary(filters: ReportFilters) {
  const range = presetDateRange(filters.datePreset, filters.fromDate, filters.toDate);
  if (!range) return 'All time';
  return `${reportPresetLabel(filters.datePreset)}: ${reportDateLabel(range.fromDate)} to ${reportDateLabel(range.toDate)}`;
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

type IconName = 'live' | 'archive' | 'record' | 'settings' | 'logout' | 'camera' | 'maximize' | 'minimize' | 'fit' | 'audio' | 'storage' | 'activity' | 'power' | 'info' | 'play' | 'stop' | 'chevron' | 'eye' | 'eyeOff';

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
    power: 'M12 3v9 M7.1 6.9a7 7 0 1 0 9.8 0',
    info: 'M12 17v-6 M12 7h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    play: 'M8 5v14l11-7z',
    stop: 'M7 7h10v10H7z',
    chevron: 'M6 9l6 6 6-6',
    eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 3l18 18 M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2 M7.1 7.1C4.2 8.8 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1 M17.3 14.7c2.6-1.6 4.2-4.7 4.2-4.7s-3.5-6-9.5-6c-1.2 0-2.4.2-3.4.6',
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
  const [showPassword, setShowPassword] = useState(false);
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
          <div className="login-logo-card">
            <img src={RICO_LOGO_SRC} alt="RICO" />
            <span>DigiTech</span>
          </div>
          <div>
            <h1>Camera Monitoring</h1>
          </div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <div>
            <div className="eyebrow">Secure Login</div>
            <h2>Sign in</h2>
          </div>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" />
          </label>
          <label>
            Password
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} />
              </button>
            </div>
          </label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary-button" type="submit">Sign In</button>
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
  stats,
  collapsed,
  onToggleSidebar,
  onCaptureVideoChange,
  onSaveSettings,
  onTestPlc,
  onStartSmartRecording,
  onStopSmartRecording,
  onLogout,
  settingsMessage,
  plcTestResult,
}: {
  page: Page;
  setPage: (page: Page) => void;
  settings: CameraSettings;
  setSettings: (settings: CameraSettings) => void;
  recording: RecordingStatus;
  plc: PlcStatus;
  stats: RecordingStats;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onCaptureVideoChange: (enabled: boolean) => void;
  onSaveSettings: () => void;
  onTestPlc: () => void;
  onStartSmartRecording: () => void;
  onStopSmartRecording: () => void;
  onLogout: () => void;
  settingsMessage: string;
  plcTestResult: PlcTestResult | null;
}) {
  const update = <K extends keyof CameraSettings>(key: K, value: CameraSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };
  const smartEnabled = plc.enabled !== false && plc.running;
  const reportCount = stats.storage.video_count || stats.today.total_events || 0;

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <button className="sidebar-toggle" type="button" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggleSidebar}>
        <Icon name="chevron" />
      </button>
      <div className="sidebar-brand">
        <div className="brand-lockup" aria-label="RICO">
          <img className="sidebar-logo-img" src={RICO_LOGO_SRC} alt="RICO" />
          <div className="rico-wordmark">RICO</div>
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
          <span className="nav-text">Live View</span>
        </button>
        <button className={page === 'saved' ? 'active' : ''} onClick={() => setPage('saved')}>
          <span className="nav-icon"><Icon name="archive" /></span>
          <span className="nav-text">Event Report</span>
          <span className="nav-count">{reportCount}</span>
        </button>
        <span className="nav-label">Recording</span>
        <div className="recording-card recording-stack">
          <div className="recording-control-row">
            <div>
              <strong>Gate Trigger</strong>
              <span>{smartEnabled ? (settings.capture_video ? 'Auto recording enabled' : 'Timing capture enabled') : 'Auto capture off'}</span>
            </div>
            <button
              type="button"
              className={smartEnabled ? 'icon-toggle on' : 'icon-toggle'}
              aria-pressed={smartEnabled}
              title={smartEnabled ? 'Turn gate trigger off' : 'Turn gate trigger on'}
              onClick={smartEnabled ? onStopSmartRecording : onStartSmartRecording}
            >
              <Icon name="power" />
              <span>{smartEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <div className="recording-control-row video-mode-row">
            <div>
              <strong>Video</strong>
              <span>{settings.capture_video ? 'Capture video with events' : 'Timing only, no video files'}</span>
            </div>
            <button
              type="button"
              className={settings.capture_video ? 'icon-toggle on' : 'icon-toggle'}
              aria-pressed={settings.capture_video}
              title={settings.capture_video ? 'Turn event video off' : 'Turn event video on'}
              onClick={() => onCaptureVideoChange(!settings.capture_video)}
            >
              <Icon name="camera" />
              <span>{settings.capture_video ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
        <span className="nav-label">System</span>
        <details className="settings-menu">
          <summary>
            <span className="nav-icon"><Icon name="settings" /></span>
            <span>Settings</span>
            <Icon name="chevron" />
          </summary>
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
            <label>
              Public helper URL
              <input value={settings.public_helper_url} onChange={(event) => update('public_helper_url', event.target.value)} />
            </label>
            <div className="settings-section-title">PLC Gate Signal</div>
            <label>
              PLC IP
              <input value={settings.plc_host} onChange={(event) => update('plc_host', event.target.value)} />
            </label>
            <div className="field-grid">
              <label>
                Port
                <input type="number" value={settings.plc_port} onChange={(event) => update('plc_port', Number(event.target.value))} />
              </label>
              <label>
                Device
                <input value={settings.plc_device} onChange={(event) => update('plc_device', event.target.value.toUpperCase())} />
              </label>
            </div>
            <label>
              Gate address
              <input value={settings.plc_address} onChange={(event) => update('plc_address', event.target.value.toUpperCase())} />
            </label>
            <label>
              Minor stoppage limit seconds
              <input
                type="number"
                min="1"
                value={settings.max_record_seconds}
                onChange={(event) => update('max_record_seconds', Math.max(1, Number(event.target.value)))}
              />
            </label>
            <label>
              Video capture mode
              <select
                value={settings.capture_breakdown_video ? 'full_event' : 'minor_only'}
                onChange={(event) => update('capture_breakdown_video', event.target.value === 'full_event')}
              >
                <option value="full_event">Full event - include breakdown</option>
                <option value="minor_only">Minor stoppage only</option>
              </select>
            </label>
            <div className="settings-actions">
              <button type="button" onClick={onTestPlc}>Test PLC</button>
              <button type="button" className="primary-mini" onClick={onSaveSettings}>Save Settings</button>
            </div>
            {settingsMessage && <div className="settings-message">{settingsMessage}</div>}
            {plcTestResult && (
              <div className={plcTestResult.ok ? 'settings-message good' : 'settings-message bad'}>
                {plcTestResult.message}
              </div>
            )}
            <div className="settings-status">
              <span><Icon name="camera" /> Camera <strong>{settings.ip}</strong></span>
              <span><Icon name="info" /> PLC <strong>{settings.plc_host}:{settings.plc_port}</strong></span>
              <span><Icon name="activity" /> Frames <strong>{recording.frames || 0}</strong></span>
              <span><Icon name="record" /> Record <strong>{recording.running ? 'Active' : 'Idle'}</strong></span>
              <span><Icon name="audio" /> Audio <strong>{recording.audio?.includes('enabled') ? 'On' : 'Off'}</strong></span>
              <span><Icon name="storage" /> Storage <strong>{settings.storage_root}</strong></span>
              <span><Icon name="storage" /> Link host <strong>{settings.public_helper_url}</strong></span>
              <span><Icon name="activity" /> Clip limit <strong>{formatDuration(settings.max_record_seconds)}</strong></span>
              <span><Icon name="record" /> Video mode <strong>{settings.capture_breakdown_video ? 'Full event' : 'Minor only'}</strong></span>
            </div>
          </div>
        </details>
      </nav>

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

function TopBar({
  page,
  recording,
  settings,
  online,
  plc,
}: {
  page: Page;
  recording: RecordingStatus;
  settings: CameraSettings;
  online: boolean;
  plc: PlcStatus;
}) {
  const eventActive = Boolean(plc.gate_open || plc.current_event_type);
  const recordingText = recording.running ? 'Recording' : eventActive ? 'Event active' : 'Recording off';
  const recordingClass = recording.running ? 'record-chip active' : eventActive ? 'record-chip event' : 'record-chip';
  return (
    <div className="topbar">
      <div>
        <strong>{APP_TITLE}</strong>
        <span>{page === 'live' ? 'Live View' : 'Event Report'}</span>
      </div>
      <div className="topbar-actions">
        <span className={online ? 'topbar-cta' : 'topbar-cta off'}><i></i> {online ? 'Stream on' : 'Stream off'}</span>
        <span className={recordingClass}><i></i> {recordingText}</span>
        <span className="channel-chip">CH {settings.channel}</span>
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
  const liveAudioUrl = useMemo(() => audioUrl(settings), [settings]);
  const liveFrameRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [compact, setCompact] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const [activeEvent, setActiveEvent] = useState<{
    type: 'minor_stoppage' | 'breakdown';
    startedAt: string;
    lastSeenAt: number;
  } | null>(null);

  async function toggleFullscreen() {
    const target = liveFrameRef.current;
    if (!target) return;
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }
    await target.requestFullscreen();
  }

  function toggleAudio() {
    setAudioError('');
    setAudioEnabled((enabled) => !enabled);
  }

  useEffect(() => {
    if (!audioEnabled) {
      audioRef.current?.pause();
      return;
    }
    audioRef.current?.play().catch(() => {
      setAudioError('Live audio start nahi hua. FFmpeg install/path aur camera audio enable check karein.');
    });
  }, [audioEnabled, liveAudioUrl]);

  const liveEventType = normalizeGateEventType(plc.current_event_type || recording.event_type);
  const liveEventStartedAt = plc.current_event_started_at || recording.event_started_at || recording.started_at;
  const liveEventSignalActive = Boolean(liveEventType && (plc.current_event_type || plc.gate_open || recording.running));

  useEffect(() => {
    const timestamp = Date.now();
    setActiveEvent((current) => {
      if (liveEventSignalActive && liveEventType) {
        return {
          type: liveEventType,
          startedAt: liveEventStartedAt || current?.startedAt || new Date().toISOString(),
          lastSeenAt: timestamp,
        };
      }
      if ((plc.gate_open || recording.running) && current) {
        return { ...current, lastSeenAt: timestamp };
      }
      if (!current) return null;
      const closed = Boolean(plc.gate_close && !plc.gate_open && !recording.running && !plc.current_event_type);
      const stale = timestamp - current.lastSeenAt > 8000;
      if (closed || stale) return null;
      return current;
    });
  }, [
    liveEventSignalActive,
    liveEventType,
    liveEventStartedAt,
    plc.gate_open,
    plc.gate_close,
    plc.current_event_type,
    recording.running,
  ]);

  useEffect(() => {
    if (!activeEvent && !(plc.running && plc.machine_state === 'running')) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeEvent, plc.running, plc.machine_state]);

  const activeEventType = activeEvent ? eventTypeLabel(activeEvent.type) : '';
  const activeEventSeconds = activeEvent ? secondsSince(activeEvent.startedAt, nowTick) : null;
  const activeIsBreakdown = activeEvent?.type === 'breakdown';
  const plcEndpoint = `${plc.plc_host || 'PLC'}${plc.plc_port ? `:${plc.plc_port}` : ''}`;

  return (
    <section className="workbench live-workbench">
      <div className="feed-column">
        <div className={[
          'live-frame',
          compact ? 'compact' : '',
        ].filter(Boolean).join(' ')} ref={liveFrameRef}>
          <div className="camera-status-strip">
            <span className={online ? 'mini-pill good live-timer-pill' : 'mini-pill bad'}>
              <Icon name="camera" />
              <span>{online ? 'LIVE' : 'OFFLINE'}</span>
            </span>
            {plc.last_error && (
              <span className="mini-pill bad" title={`PLC signal read failed: ${plcEndpoint}`}>
                <Icon name="info" />
                <span>PLC offline {plcEndpoint}</span>
              </span>
            )}
            {activeEventType && (
              <span className={activeIsBreakdown ? 'mini-pill breakdown event-timer-pill' : 'mini-pill event event-timer-pill'}>
                <span>{activeEventType}</span>
                <strong>{formatDuration(activeEventSeconds || 0)}</strong>
              </span>
            )}
          </div>
          <div className="live-frame-actions">
            <button
              type="button"
              className={audioEnabled ? 'audio-enabled' : ''}
              title={audioEnabled ? 'Mute live audio' : 'Play live audio'}
              onClick={toggleAudio}
            >
              <Icon name="audio" />
            </button>
            <button type="button" title={compact ? 'Restore camera view' : 'Minimize camera view'} onClick={() => setCompact((value) => !value)}>
              <Icon name={compact ? 'maximize' : 'minimize'} />
            </button>
            <button type="button" title="Fullscreen" onClick={toggleFullscreen}><Icon name="maximize" /></button>
          </div>
          <img src={liveUrl} alt="Live camera feed" />
          {audioEnabled && (
            <audio
              ref={audioRef}
              src={liveAudioUrl}
              autoPlay
              onError={() => setAudioError('Live audio unavailable hai. FFmpeg install/path aur camera audio enable check karein.')}
            />
          )}
        </div>
        {audioError && <div className="error-banner live-audio-warning">{audioError}</div>}
        {plc.last_error && <div className="error-banner live-audio-warning">PLC signal read nahi ho raha ({plcEndpoint}): {plc.last_error}</div>}
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
  const [datePreset, setDatePreset] = useState<ReportDatePreset>('today');
  const [fromDate, setFromDate] = useState(todayInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [category, setCategory] = useState('all');
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>({
    datePreset: 'today',
    fromDate: todayInputValue(),
    toDate: todayInputValue(),
    category: 'all',
  });
  const [reportStats, setReportStats] = useState<RecordingStats>(stats);
  const [list, setList] = useState<RecordingList>({ total: 0, page: 1, page_size: PAGE_SIZE, records: [] });
  const [latest, setLatest] = useState<RecordingRecord | null>(null);
  const [selected, setSelected] = useState<RecordingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const activeDateRange = useMemo(
    () => presetDateRange(appliedFilters.datePreset, appliedFilters.fromDate, appliedFilters.toDate),
    [appliedFilters.datePreset, appliedFilters.fromDate, appliedFilters.toDate],
  );
  const filtersDirty = (
    appliedFilters.datePreset !== datePreset
    || appliedFilters.fromDate !== fromDate
    || appliedFilters.toDate !== toDate
    || appliedFilters.category !== category
  );

  function changeDatePreset(value: ReportDatePreset) {
    setDatePreset(value);
    const range = presetDateRange(value, fromDate, toDate);
    if (range && value !== 'custom') {
      setFromDate(range.fromDate);
      setToDate(range.toDate);
    }
  }

  function applyFilters() {
    const range = presetDateRange(datePreset, fromDate, toDate);
    const normalizedFrom = range?.fromDate || fromDate;
    const normalizedTo = range?.toDate || toDate;
    if (range && datePreset !== 'custom') {
      setFromDate(normalizedFrom);
      setToDate(normalizedTo);
    }
    setAppliedFilters({
      datePreset,
      fromDate: normalizedFrom,
      toDate: normalizedTo,
      category,
    });
    setPage(1);
  }

  async function load(refreshIndex = false) {
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, string | number | boolean> = {
        storage_root: settings.storage_root,
        page,
        page_size: PAGE_SIZE,
      };
      if (activeDateRange) {
        payload.start_at = `${activeDateRange.fromDate}T00:00:00`;
        payload.end_at = `${activeDateRange.toDate}T23:59:59`;
      }
      if (appliedFilters.category !== 'all') {
        payload.event_type = appliedFilters.category;
      }
      const endpoint = refreshIndex ? '/recording-index/scan' : '/recording-index/list';
      const [data, summaryData] = await Promise.all([
        postJson<RecordingList>(endpoint, payload),
        postJson<RecordingList>('/recording-index/list', {
          ...payload,
          page: 1,
          page_size: 100,
        }),
      ]);
      const nextTotalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      const records = (data.records || []).slice(0, PAGE_SIZE);
      setList({ ...data, records });
      setReportStats(statsFromRecords(summaryData.records || []));
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
  }, [
    page,
    appliedFilters.datePreset,
    appliedFilters.fromDate,
    appliedFilters.toDate,
    appliedFilters.category,
    settings.storage_root,
    refreshToken,
    stats.latest_event?.started_at,
  ]);

  useEffect(() => {
    if (!plc.gate_open) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [plc.gate_open]);

  const totalPages = Math.max(1, Math.ceil((list.total || 0) / PAGE_SIZE));
  const selectedVideoUrl = useMemo(
    () => selected && videoReady(selected)
      ? `${recordingFileUrl(settings.storage_root, selected.file_path)}&v=${encodeURIComponent(String(selected.file_size || selected.updated_at || selected.ended_at || '0'))}`
      : '',
    [selected, settings.storage_root],
  );

  useEffect(() => {
    if (!selectedVideoUrl || !playerRef.current) return;
    playerRef.current.pause();
    playerRef.current.load();
  }, [selectedVideoUrl]);

  useEffect(() => {
    setError('');
  }, [selected?.file_path]);
  const latestOpenBreakdownPath = stats.latest_event?.event_type === 'breakdown' ? stats.latest_event.file_path : latest?.event_type === 'breakdown' ? latest.file_path : null;
  const exportUrl = useMemo(() => recordingExportUrl({
    storage_root: settings.storage_root,
    start_at: activeDateRange ? `${activeDateRange.fromDate}T00:00:00` : undefined,
    end_at: activeDateRange ? `${activeDateRange.toDate}T23:59:59` : undefined,
    event_type: appliedFilters.category !== 'all' ? appliedFilters.category : undefined,
    public_helper_url: settings.public_helper_url,
  }), [activeDateRange, appliedFilters.category, settings.public_helper_url, settings.storage_root]);

  function isOpenBreakdown(record: RecordingRecord) {
    return Boolean(plc.gate_open && record.event_type === 'breakdown' && latestOpenBreakdownPath && record.file_path === latestOpenBreakdownPath);
  }

  function liveBreakdownDuration(record: RecordingRecord) {
    if (record.event_type === 'breakdown' && !record.event_ended_at) {
      const elapsed = secondsSince(record.event_started_at || stats.latest_event?.event_started_at || record.started_at, nowTick);
      if (elapsed !== null) return elapsed;
    }
    if (isOpenBreakdown(record)) {
      const elapsed = secondsSince(record.event_started_at || stats.latest_event?.event_started_at || record.started_at, nowTick);
      if (elapsed !== null) return elapsed;
    }
    return eventDuration(record);
  }

  function liveEventEnd(record: RecordingRecord) {
    if (record.event_type === 'breakdown' && !record.event_ended_at) return 'Running';
    return isOpenBreakdown(record) ? 'Running' : formatDateTime(eventEnd(record));
  }

  function liveStatus(record: RecordingRecord, isSelected: boolean) {
    if (isRecordingOpen(record)) return 'Running';
    if (record.event_type === 'breakdown' && !record.event_ended_at) return 'Running';
    if (isOpenBreakdown(record)) return 'Running';
    return isSelected ? 'Playing' : clipStatus(record);
  }

  return (
    <section className="workbench saved-workbench">
      <div className="library-column">
        <KpiCards stats={reportStats} />

        <div className="library-header">
          <div>
            <h2>Event Report</h2>
            <span>{list.total} events</span>
          </div>
          <div className="library-actions">
            <a className="download-button report-download" href={exportUrl}><Icon name="storage" /> Download Report</a>
            <button onClick={() => load(true)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
          </div>
        </div>

        <div className="report-range-strip">
          <span>Date Range</span>
          <strong>{reportRangeSummary(appliedFilters)}</strong>
          <em>{reportCategoryLabel(appliedFilters.category)}</em>
        </div>

        <div className="filter-card compact-filter">
          <label>
            Period
            <select value={datePreset} onChange={(event) => changeDatePreset(event.target.value as ReportDatePreset)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_7">Last 7 Days</option>
              <option value="last_15">Last 15 Days</option>
              <option value="custom">Custom Range</option>
              <option value="all">All Time</option>
            </select>
          </label>
          <label>
            From
            <input type="date" disabled={datePreset !== 'custom'} value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" disabled={datePreset !== 'custom'} value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All</option>
              <option value="minor_stoppage">Minor Stoppage (&lt; 5 min)</option>
              <option value="breakdown">Breakdown (&gt; 5 min)</option>
            </select>
          </label>
          <div className="filter-apply">
            <button type="button" onClick={applyFilters} disabled={!filtersDirty || loading}>
              Apply
            </button>
            <span className={filtersDirty ? 'filter-state pending' : 'filter-state'}>
              {filtersDirty ? 'Pending changes' : 'Applied'}
            </span>
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
            <span>S.No</span>
            <span>Start Date & Time</span>
            <span>End Time</span>
            <span>Video Duration</span>
            <span>Event Duration</span>
            <span>File Size</span>
            <span>Category</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {list.records.map((record, index) => {
            const isSelected = selected?.file_path === record.file_path;
            const status = liveStatus(record, isSelected);
            const videoAvailable = hasVideo(record);
            const readyForVideo = videoReady(record);
            const serialNumber = (page - 1) * PAGE_SIZE + index + 1;
            return (
              <article className={isSelected ? 'record-row selected' : 'record-row'} key={record.file_path}>
                <span className="record-index">{serialNumber}</span>
                <button className="record-time" title={record.file_name} onClick={() => setSelected({ ...record })}>
                  <strong>{formatDateTime(record.started_at)}</strong>
                </button>
                <span className="record-duration">{formatTimeOnly(liveEventEnd(record))}</span>
                <span className="record-duration">{formatDuration(record.duration_seconds)}</span>
                <span className="record-duration">{formatDuration(liveBreakdownDuration(record))}</span>
                <span className="record-size">{formatSize(record.file_size)}</span>
                <span className={record.event_type === 'breakdown' ? 'status-badge bad' : 'status-badge neutral'}>{eventTypeLabel(record.event_type)}</span>
                <span className={record.error ? 'status-badge bad' : 'status-badge good'}>{status}</span>
                <div className="row-actions">
                  {readyForVideo ? (
                    <>
                      <button disabled={isSelected} onClick={() => setSelected({ ...record })}>{isSelected ? 'Playing' : 'Play'}</button>
                      <a className="download-button" href={recordingFileUrl(settings.storage_root, record.file_path, true)}><Icon name="storage" /> Download</a>
                    </>
                  ) : videoAvailable ? (
                    <span className="recording-note">Recording...</span>
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
        {selected && videoReady(selected) ? (
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
            <a className="download-button rail-save" href={recordingFileUrl(settings.storage_root, selected.file_path, true)}><Icon name="storage" /> Download</a>
            <div className="rail-section">
              <dl className="detail-list">
                <dt>Date</dt><dd>{formatDateTime(selected.started_at).split(',')[0]}</dd>
                <dt>Start</dt><dd>{formatDateTime(eventStart(selected))}</dd>
                <dt>End</dt><dd>{liveEventEnd(selected)}</dd>
                <dt>Video duration</dt><dd>{formatDuration(selected.duration_seconds)}</dd>
                <dt>Event duration</dt><dd>{formatDuration(liveBreakdownDuration(selected))}</dd>
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
            <span>{hasVideo(selected) ? 'Video finalize ho raha hai. Event complete hone ke baad preview/download available hoga.' : 'No video available for this event.'}</span>
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
  const [settings, setSettings] = useState<CameraSettings>(() => loadSavedSettings());
  const [recording, setRecording] = useState<RecordingStatus>({ running: false, frames: 0 });
  const [plc, setPlc] = useState<PlcStatus>({ enabled: true, running: false });
  const [plcTestResult, setPlcTestResult] = useState<PlcTestResult | null>(null);
  const [stats, setStats] = useState<RecordingStats>(() => emptyStats());
  const [cameraOnline, setCameraOnline] = useState(false);
  const [message, setMessage] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const previousRecordingRunningRef = useRef(false);

  async function refreshStatus() {
    try {
      const [recordingStatus, plcStatus] = await Promise.all([
        getJson<RecordingStatus>('/recording/status'),
        getJson<PlcStatus>('/plc-monitor/status'),
      ]);
      if (previousRecordingRunningRef.current && !recordingStatus.running) {
        setRefreshToken((value) => value + 1);
        refreshStats();
      }
      previousRecordingRunningRef.current = Boolean(recordingStatus.running);
      setRecording(recordingStatus);
      setPlc(plcStatus);
      if (typeof plcStatus.capture_video === 'boolean') {
        setSettings((current) => (
          current.capture_video === plcStatus.capture_video
            ? current
            : { ...current, capture_video: plcStatus.capture_video }
        ));
      }
      if (typeof plcStatus.capture_breakdown_video === 'boolean') {
        setSettings((current) => (
          current.capture_breakdown_video === plcStatus.capture_breakdown_video
            ? current
            : { ...current, capture_breakdown_video: plcStatus.capture_breakdown_video }
        ));
      }
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

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function startSmartRecording() {
    setMessage('');
    try {
      const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(settings));
      setPlc(status);
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function saveSettings(nextSettings = settings) {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    setSettingsMessage(
      `Settings saved. Minor stoppage limit: ${formatDuration(nextSettings.max_record_seconds)}. `
      + `Video: ${nextSettings.capture_breakdown_video ? 'full event' : 'minor only'}.`,
    );
    if (plc.enabled !== false && plc.running) {
      try {
        const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(nextSettings));
        setPlc(status);
      } catch (exc) {
        const error = friendlyError(exc);
        if (error) setSettingsMessage(error);
      }
    }
  }

  async function testPlcSettings() {
    setSettingsMessage('Testing PLC...');
    setPlcTestResult(null);
    try {
      const result = await postJson<PlcTestResult>('/plc-test', buildPlcPayload(settings));
      setPlcTestResult(result);
      setSettingsMessage(result.ok ? 'PLC test OK. Save settings to use this config.' : 'PLC test failed. Check IP, port, protocol, and address.');
    } catch (exc) {
      const error = friendlyError(exc);
      setSettingsMessage(error || 'PLC test failed.');
    }
  }

  async function setCaptureVideo(enabled: boolean) {
    const nextSettings = { ...settings, capture_video: enabled };
    setSettings(nextSettings);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    if (!(plc.enabled !== false && plc.running)) return;
    setMessage('');
    try {
      const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(nextSettings));
      setPlc(status);
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function stopSmartRecording() {
    setMessage('');
    try {
      const status = await postJson<PlcStatus>('/plc-monitor/stop', {});
      setPlc(status);
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
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <Sidebar
        page={page}
        setPage={setPage}
        settings={settings}
        setSettings={setSettings}
        recording={recording}
        plc={plc}
        stats={stats}
        collapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
        onCaptureVideoChange={setCaptureVideo}
        onSaveSettings={() => saveSettings()}
        onTestPlc={testPlcSettings}
        onStartSmartRecording={startSmartRecording}
        onStopSmartRecording={stopSmartRecording}
        settingsMessage={settingsMessage}
        plcTestResult={plcTestResult}
        onLogout={logout}
      />
      <main className="content">
        <TopBar page={page} recording={recording} settings={settings} online={cameraOnline} plc={plc} />
        {message && <div className="error-banner">{message}</div>}
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
        <footer className="status-footer">
          <span><Icon name="storage" /> {settings.storage_root}</span>
          <span>Helper: {API_BASE}</span>
          <time>{clock.toLocaleString()}</time>
        </footer>
      </main>
    </div>
  );
}
