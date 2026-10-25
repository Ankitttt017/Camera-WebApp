import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { HierarchyManager } from './HierarchyManager';
import { SettingsHub } from './SettingsHub';
import { MultiCamGrid } from './MultiCamGrid';
import { CameraEditModal } from './CameraEditModal';
import LiveStreamImage from './LiveStreamImage';
import {
  API_BASE,
  AuthSession,
  CameraSettings,
  PlcStatus,
  ReasonOptions,
  RecordingList,
  RecordingRecord,
  RecordingStats,
  RecordingStatus,
  audioUrl,
  authElevate,
  authLogin,
  buildCameraPayload,
  buildPlcPayload,
  buildSettingsPayload,
  getJson,
  mjpegUrl,
  postJson,
  reasonsPath,
  recordingExportUrl,
  recordingFileUrl,
  setAuthToken,
  PlcTestResult,
  FlatCamera,
  HierarchyPlant,
  fetchHierarchy,
  fetchFlatCameras,
  hierarchyCameraSnapshotUrl,
  hierarchyCameraMjpegUrl,
  hierarchyCameraAudioUrl,
} from './api';

const DEFAULT_PUBLIC_HELPER_URL = API_BASE;
const LEGACY_PUBLIC_HELPER_URLS = new Set([
  'http://192.168.100.137:8010',
  'http://192.168.100.136:8010',
  'http://192.168.119.205:8010',
  'http://172.16.4.242:8010',
  'http://127.0.0.1:8010',
]);
const DEFAULT_STORAGE_ROOT = '/home/automation/apps/Camera-WebApp/camera_app/recordings';
const LEGACY_STORAGE_ROOTS = new Set([
  'D:\\CPPLUS_RECORDINGS',
]);

const DOWNTIME_TYPES = [
  "Machine Breakdown",
  "Management Loss",
  "Die Breakdown",
  "Robot Breakdown",
  "Planned Downtime",
  "Process Loss",
  "HPDC Machine Accessories"
];

const DOWNTIME_TYPE_CONFIG: Record<string, { color: string; bg: string; border: string; glow: string; icon: string }> = {
  "Machine Breakdown": {
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.18)',
    border: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.4)',
    icon: '⚙️'
  },
  "Die Breakdown": {
    color: '#f97316',
    bg: 'rgba(249, 115, 22, 0.18)',
    border: '#f97316',
    glow: 'rgba(249, 115, 22, 0.4)',
    icon: '🔩'
  },
  "Robot Breakdown": {
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.18)',
    border: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.4)',
    icon: '🤖'
  },
  "HPDC Machine Accessories": {
    color: '#ec4899',
    bg: 'rgba(236, 72, 153, 0.18)',
    border: '#ec4899',
    glow: 'rgba(236, 72, 153, 0.4)',
    icon: '🔌'
  },
  "Process Loss": {
    color: '#0ea5e9',
    bg: 'rgba(14, 165, 233, 0.18)',
    border: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.4)',
    icon: '⚡'
  },
  "Planned Downtime": {
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.18)',
    border: '#10b981',
    glow: 'rgba(16, 185, 129, 0.4)',
    icon: '⏱️'
  },
  "Management Loss": {
    color: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.18)',
    border: '#6366f1',
    glow: 'rgba(99, 102, 241, 0.4)',
    icon: '📋'
  }
};

import { ACTUAL_DOWNTIME_DATA } from './downtimeData';

const DEFAULT_SETTINGS: CameraSettings = {
  ip: '192.168.119.205',
  http_port: 80,
  rtsp_port: 554,
  username: 'admin',
  password: 'Admin@123',
  channel: 1,
  rtsp_path: '/video/live?channel=1&subtype=0',
  storage_root: DEFAULT_STORAGE_ROOT,
  public_helper_url: DEFAULT_PUBLIC_HELPER_URL,
  capture_video: true,
  capture_breakdown_video: true,
  plc_enabled: true,
  plc_host: '192.168.117.201',
  plc_port: 5003,
  plc_device: 'X',
  plc_address: '4A',
  max_record_seconds: 300,
};

const SETTINGS_STORAGE_KEY = 'rico-camera-settings';

const PAGE_SIZE = 10;
const APP_TITLE = 'Automatic Video Capturing Ube 850 T-2';
const APP_MARK = 'RCC';
const RICO_LOGO_SRC = '/rico-logo.png';

type Page = 'live' | 'saved' | 'hierarchy';
type UserRole = 'superadmin' | 'admin' | 'user';

function normalizePublicHelperUrl(value?: string | null) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return DEFAULT_PUBLIC_HELPER_URL;
  return text;
}

function normalizeSettings(settings: CameraSettings): CameraSettings {
  return {
    ...settings,
    public_helper_url: normalizePublicHelperUrl(settings.public_helper_url),
  };
}

function loadSavedSettings(): CameraSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    if (LEGACY_PUBLIC_HELPER_URLS.has(String(saved.public_helper_url).trim())) {
      saved.public_helper_url = DEFAULT_PUBLIC_HELPER_URL;
    }
    if (!saved.storage_root || LEGACY_STORAGE_ROOTS.has(String(saved.storage_root).trim())) {
      saved.storage_root = DEFAULT_STORAGE_ROOT;
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
  return date.toLocaleString('en-GB', { hour12: false });
}

function formatDateOnly(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.split('T')[0];
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function paginationItems(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push('gap');
    items.push(p);
  });
  return items;
}

function formatTimeOnly(value?: string | null) {
  if (!value) return '-';
  if (value === 'Running') return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const parts = value.replace('T', ' ').split(' ');
    return parts[1] || value;
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
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

function getLiveMachineTimerSeconds(plc?: PlcStatus): { state: 'running' | 'breakdown' | 'minor_stoppage'; seconds: number; startedAt: string | null } {
  if (!plc) return { state: 'running', seconds: 0, startedAt: null };

  const rawState = plc.machine_state || (plc.gate_open ? 'minor_stoppage' : 'running');
  const state: 'running' | 'breakdown' | 'minor_stoppage' =
    rawState === 'breakdown' ? 'breakdown' : rawState === 'minor_stoppage' ? 'minor_stoppage' : 'running';

  const startedAt =
    (state !== 'running' ? (plc.current_event_started_at || plc.machine_state_started_at || plc.last_gate_opened_at) : plc.machine_state_started_at) || null;

  if (startedAt) {
    const elapsed = secondsSince(startedAt);
    if (elapsed !== null) {
      return { state, seconds: Math.floor(elapsed), startedAt };
    }
  }

  const fallback = Math.floor(
    (state !== 'running' ? (plc.current_event_duration_seconds || plc.machine_state_duration_seconds) : plc.machine_state_duration_seconds) || 0
  );
  return { state, seconds: Math.max(0, fallback), startedAt };
}

function formatTimerDisplay(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

function KpiCards({ stats, thresholdSeconds }: { stats: RecordingStats; thresholdSeconds: number }) {
  const totalEvents = stats.today.total_events || 0;
  const averageDuration = totalEvents ? stats.today.recorded_duration_seconds / totalEvents : 0;
  const threshold = stoppageThresholdLabel(thresholdSeconds);
  const cards: { label: string; value: string | number; icon: IconName; tone: string }[] = [
    { label: 'Total events', value: totalEvents, icon: 'calendar', tone: 'blue' },
    { label: `Minor stoppage (< ${threshold})`, value: stats.today.minor_stoppage_count || 0, icon: 'pause', tone: 'amber' },
    { label: `Breakdown (> ${threshold})`, value: stats.today.breakdown_count || 0, icon: 'alert', tone: 'red' },
    { label: 'Avg event duration', value: averageDuration > 0 ? formatDuration(averageDuration) : '—', icon: 'clock', tone: 'violet' },
  ];

  return (
    <div className="er-kpis">
      {cards.map((card) => (
        <div key={card.label} className={`er-kpi er-kpi-${card.tone}`}>
          <span className="er-kpi-icon"><Icon name={card.icon} /></span>
          <div>
            <span className="er-kpi-label">{card.label}</span>
            <strong className="er-kpi-value">{card.value}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function todayInputValue() {
  return dateInputValue(currentBusinessDate());
}

function dateInputValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

type ReportDatePreset = 'today' | 'yesterday' | 'last_7' | 'last_15' | 'custom' | 'all';
type ReportShift = 'all' | 'A' | 'B' | 'C';
type PlaybackState = 'idle' | 'loading' | 'ready' | 'error';
type ReportFilters = {
  datePreset: ReportDatePreset;
  fromDate: string;
  toDate: string;
  category: string;
  shift: ReportShift;
};

function currentBusinessDate() {
  const date = new Date();
  if (date.getHours() < 6) {
    date.setDate(date.getDate() - 1);
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function localDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 19);
}

function presetDateRange(preset: ReportDatePreset, fromDate: string, toDate: string) {
  const today = currentBusinessDate();
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

function businessDateTimeRange(range: { fromDate: string; toDate: string } | null) {
  if (!range) return null;
  const start = new Date(`${range.fromDate}T06:00:00`);
  const end = new Date(`${range.toDate}T06:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  end.setDate(end.getDate() + 1);
  end.setSeconds(end.getSeconds() - 1);
  return {
    fromDate: range.fromDate,
    toDate: range.toDate,
    startAt: localDateTimeValue(start),
    endAt: localDateTimeValue(end),
  };
}

function toDDMMYYYY(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

function parseDDMMYYYY(str: string): string | null {
  if (!str) return null;
  const match = str.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  const dNum = parseInt(day, 10);
  const mNum = parseInt(month, 10);
  const yNum = parseInt(year, 10);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31 || yNum < 2000 || yNum > 2100) return null;
  return `${year}-${month}-${day}`;
}

function DateInputDDMMYYYY({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const hiddenDateRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState(() => toDDMMYYYY(value));

  useEffect(() => {
    setInputText(toDDMMYYYY(value));
  }, [value]);

  const handleBlur = () => {
    const parsed = parseDDMMYYYY(inputText);
    if (parsed) {
      onChange(parsed);
      setInputText(toDDMMYYYY(parsed));
    } else {
      setInputText(toDDMMYYYY(value));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  const openCalendar = () => {
    if (disabled) return;
    try {
      hiddenDateRef.current?.showPicker?.();
    } catch {
      hiddenDateRef.current?.focus();
    }
  };

  return (
    <div className="date-input-ddmmyyyy" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <input
        type="text"
        disabled={disabled}
        value={inputText}
        placeholder="DD/MM/YYYY"
        onChange={(e) => setInputText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={openCalendar}
        style={{ paddingRight: '28px', letterSpacing: '0.04em', cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openCalendar}
        style={{
          position: 'absolute',
          right: '8px',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? '#475569' : '#94a3b8',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Calendar"
      >
        📅
      </button>
      <input
        ref={hiddenDateRef}
        type="date"
        disabled={disabled}
        value={value}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
          }
        }}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: 'none',
          border: 'none',
          padding: 0,
        }}
      />
    </div>
  );
}

function reportDateLabel(value: string) {
  const parts = value.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function reportPresetLabel(value: ReportDatePreset) {
  if (value === 'today') return 'Today';
  if (value === 'yesterday') return 'Yesterday';
  if (value === 'last_7') return 'Last 7 Days';
  if (value === 'last_15') return 'Last 15 Days';
  if (value === 'custom') return 'Custom Range';
  return 'All Time';
}

function stoppageThresholdLabel(seconds: number) {
  const safeSeconds = Math.max(1, Number(seconds || 300));
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60} min`;
  return formatDuration(safeSeconds);
}

function reportCategoryLabel(value: string, thresholdSeconds: number) {
  const threshold = stoppageThresholdLabel(thresholdSeconds);
  if (value === 'breakdown') return `Breakdown (> ${threshold})`;
  if (value === 'minor_stoppage') return `Minor Stoppage (< ${threshold})`;
  return 'All Categories';
}

function reportShiftLabel(value: ReportShift) {
  if (value === 'A') return 'Shift A';
  if (value === 'B') return 'Shift B';
  if (value === 'C') return 'Shift C';
  return 'All Shifts';
}

function formatIsoToDDMMYYYY(isoStr: string) {
  try {
    const [dPart, tPart] = isoStr.split('T');
    const [y, m, d] = dPart.split('-');
    const time = tPart ? tPart.slice(0, 5) : '';
    return time ? `${d}/${m}/${y} ${time}` : `${d}/${m}/${y}`;
  } catch {
    return isoStr;
  }
}

function reportRangeSummary(filters: ReportFilters) {
  const range = presetDateRange(filters.datePreset, filters.fromDate, filters.toDate);
  if (!range) return 'All time';
  const businessRange = businessDateTimeRange(range);
  if (!businessRange) return `${reportPresetLabel(filters.datePreset)}: ${reportDateLabel(range.fromDate)} to ${reportDateLabel(range.toDate)}`;
  const startLabel = formatIsoToDDMMYYYY(businessRange.startAt);
  const endLabel = formatIsoToDDMMYYYY(businessRange.endAt);
  return `${reportPresetLabel(filters.datePreset)}: ${startLabel} to ${endLabel}`;
}

function friendlyError(exc: unknown) {
  const message = exc instanceof Error ? exc.message : String(exc);
  const normalized = message.trim().toLowerCase();
  if (!normalized || normalized === 'not found' || normalized === '404' || normalized === '404 not found') {
    return '';
  }
  if (message === 'Failed to fetch') {
    return `Helper API is not running on ${API_BASE}. Start the helper and refresh.`;
  }
  if (message.includes('RTSP') || message.includes('Unauthorized') || message.includes('stream open')) {
    return 'Unable to connect to camera stream. If live preview is active, wait a moment and retry; also check camera login/RTSP settings.';
  }
  return message;
}

function friendlyRecordingError(message?: string | null) {
  if (!message) return '';
  if (message.includes('RTSP') || message.includes('Unauthorized') || message.includes('stream open')) {
    return 'Unable to connect to recording stream. Check camera access settings and retry.';
  }
  return 'Recording could not be completed. Check settings and camera connection.';
}

type IconName = 'live' | 'archive' | 'record' | 'settings' | 'logout' | 'camera' | 'maximize' | 'minimize' | 'fit' | 'audio' | 'volumeOff' | 'storage' | 'activity' | 'power' | 'info' | 'play' | 'pause' | 'stop' | 'chevron' | 'eye' | 'eyeOff' | 'lock' | 'close' | 'chart' | 'reload' | 'download' | 'edit' | 'mic' | 'filter' | 'file' | 'calendar' | 'alert' | 'clock';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    close: 'M18 6L6 18M6 6l12 12',
    live: 'M4 6.5h16v11H4z M9 20h6 M12 17.5V20',
    archive: 'M5 7h14v12H5z M8 4h8v3 M8 11h8',
    chart: 'M18 20V10M12 20V4M6 20v-6',
    record: 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z M12 3v3 M12 18v3 M4.2 6.2l2.1 2.1 M17.7 15.7l2.1 2.1 M3 12h3 M18 12h3 M4.2 17.8l2.1-2.1 M17.7 8.3l2.1-2.1',
    logout: 'M10 5H5v14h5 M14 8l4 4-4 4 M8 12h10',
    camera: 'M4 7h11v10H4z M15 10l5-3v10l-5-3z',
    maximize: 'M5 10V5h5 M14 5h5v5 M19 14v5h-5 M10 19H5v-5',
    minimize: 'M10 4v6h-6 M14 4v6h6 M10 20v-6h-6 M14 20v-6h6',
    fit: 'M8 5H5v3 M16 5h3v3 M19 16v3h-3 M8 19H5v-3',
    audio: 'M5 10v4h3l4 3V7L8 10z M16 9a4 4 0 0 1 0 6',
    volumeOff: 'M5 10v4h3l4 3V7L8 10z M17 9l6 6M23 9l-6 6',
    storage: 'M5 6c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2z M5 6v6c0 1.1 3.1 2 7 2s7-.9 7-2V6 M5 12v6c0 1.1 3.1 2 7 2s7-.9 7-2v-6',
    activity: 'M4 12h4l2-6 4 12 2-6h4',
    power: 'M12 3v9 M7.1 6.9a7 7 0 1 0 9.8 0',
    info: 'M12 17v-6 M12 7h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7z M13 5h4v14h-4z',
    stop: 'M7 7h10v10H7z',
    chevron: 'M6 9l6 6 6-6',
    eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 3l18 18 M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2 M7.1 7.1C4.2 8.8 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1 M17.3 14.7c2.6-1.6 4.2-4.7 4.2-4.7s-3.5-6-9.5-6c-1.2 0-2.4.2-3.4.6',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2 M6 10h12v10H6z M12 14v3 M9 10V8a3 3 0 0 1 6 0v2',
    reload: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
    edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
    filter: 'M4 5h16l-6 7.5V19l-4 1v-7.5z',
    file: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
    alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function Login({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('operator');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    const loginUsername = normalizedUsername === 'operaor' ? 'operator' : normalizedUsername;
    try {
      const session = await authLogin(loginUsername, password);
      onLogin(session);
      return;
    } catch {
      // Mock logins removed for security. Only backend AUTH_USERS are allowed.
    }
    setError('Invalid username or password.');
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-intro">
          <div className="login-logo-card">
            <strong className="login-wordmark" aria-label="RicoDigiTech">
              <span className="login-rico-blue">RICO</span>
              <span className="login-digitech">DigiTech</span>
            </strong>
          </div>
          <div>
            <h1>Automatic Camera Monitoring</h1>
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

function ReasonDialog({
  open,
  category,
  reasonOptions,
  saving,
  error,
  initialReason = '',
  initialNote = '',
  canAddReason,
  onClose,
  onSubmit,
  onAddReason,
}: {
  open: boolean;
  category: 'minor_stoppage' | 'breakdown';
  reasonOptions: ReasonOptions;
  saving: boolean;
  error: string;
  initialReason?: string;
  initialNote?: string;
  canAddReason: boolean;
  onClose: () => void;
  onSubmit: (payload: { category: 'minor_stoppage' | 'breakdown'; reason: string; note: string }) => void;
  onAddReason: (category: 'minor_stoppage' | 'breakdown', reason: string) => Promise<void>;
}) {
  const [selectedCategory, setSelectedCategory] = useState<'minor_stoppage' | 'breakdown'>(category);
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);
  const [newReason, setNewReason] = useState('');
  const options = reasonOptions[selectedCategory] || [];

  useEffect(() => {
    if (!open) return;
    setSelectedCategory(category);
    setReason(initialReason);
    setNote(initialNote);
    setNewReason('');
  }, [open, category, initialReason, initialNote]);

  async function addReason() {
    const value = newReason.trim();
    if (!value) return;
    await onAddReason(selectedCategory, value);
    setReason(value);
    setNewReason('');
  }

  if (!open) return null;

  return (
    <div className="reason-backdrop" role="dialog" aria-modal="true">
      <div className="reason-dialog">
        <div className="reason-dialog-head">
          <div>
            <strong>Gate Open Reason</strong>
            <span>{eventTypeLabel(selectedCategory)}</span>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <div className="reason-tabs">
          <button
            type="button"
            className={selectedCategory === 'minor_stoppage' ? 'active' : ''}
            onClick={() => setSelectedCategory('minor_stoppage')}
          >
            Minor Stoppage
          </button>
          <button
            type="button"
            className={selectedCategory === 'breakdown' ? 'active' : ''}
            onClick={() => setSelectedCategory('breakdown')}
          >
            Breakdown
          </button>
        </div>

        <label>
          Reason
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="">Select reason</option>
            {options.map((item) => (
              <option key={`${item.category}-${item.reason}`} value={item.reason}>{item.reason}</option>
            ))}
          </select>
        </label>

        {canAddReason && (
          <div className="reason-add-row">
            <input value={newReason} onChange={(event) => setNewReason(event.target.value)} placeholder="Add new reason" />
            <button type="button" onClick={addReason} disabled={!newReason.trim() || saving}>Add</button>
          </div>
        )}

        <label>
          Remark
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Optional note" />
        </label>

        {error && <div className="settings-message bad">{error}</div>}
        <div className="reason-actions">
          <button type="button" onClick={onClose}>Skip</button>
          <button type="button" className="primary-mini" disabled={!reason || saving} onClick={() => onSubmit({ category: selectedCategory, reason, note })}>
            {saving ? 'Saving...' : 'Submit Reason'}
          </button>
        </div>
      </div>
    </div>
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
  onRecordingModeChange,
  onSaveSettings,
  onTestPlc,
  onStartSmartRecording,
  onStopSmartRecording,
  onLogout,
  onAdminRequired,
  settingsMessage,
  settingsMessageTone,
  plcTestResult,
  userRole,
  activeMachineName,
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
  onRecordingModeChange: (plcEnabled: boolean) => void;
  onSaveSettings: () => void;
  onTestPlc: () => void;
  onStartSmartRecording: () => void;
  onStopSmartRecording: () => void;
  onLogout: () => void;
  onAdminRequired: (action?: () => void) => void;
  settingsMessage: string;
  settingsMessageTone: 'good' | 'bad' | 'neutral';
  plcTestResult: PlcTestResult | null;
  userRole: UserRole;
  activeMachineName?: string;
}) {
  const reportCount = stats.storage.video_count || stats.today.total_events || 146;

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'} style={{ background: '#121e3d', padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
      {/* Top Logo Lockup (Crisp white serif on deep navy) */}
      <div className="sidebar-brand" style={{ padding: '0 0 24px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="brand-lockup" aria-label="RICO">
          <div className="rico-wordmark full-logo">RICO</div>
          <div className="rico-subtext full-logo">RICO AUTO INDUSTRIES</div>
          <div className="rico-wordmark mini-logo">R</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <button className={page === 'live' ? 'active' : ''} onClick={() => setPage('live')}>
          <span className="nav-icon" style={{ fontSize: '1.15rem' }}>🖥️</span>
          <span className="nav-text">Live View</span>
        </button>
        <button className={page === 'saved' ? 'active' : ''} onClick={() => setPage('saved')}>
          <span className="nav-icon" style={{ fontSize: '1.15rem' }}>📄</span>
          <span className="nav-text">Event Report</span>
          <span className="nav-count" style={{
            marginLeft: 'auto',
            background: page === 'saved' ? '#1e40af' : '#1e3a8a',
            color: '#ffffff',
            borderRadius: '999px',
            padding: '2px 9px',
            fontSize: '0.74rem',
            fontWeight: 800
          }}>
            {reportCount}
          </span>
        </button>
        <button className={page === 'hierarchy' ? 'active' : ''} onClick={() => setPage('hierarchy')}>
          <span className="nav-icon" style={{ fontSize: '1.15rem' }}>⚙️</span>
          <span className="nav-text">Settings & Admin</span>
        </button>
      </nav>

      {/* Subtle Minimal Footer */}
      {!collapsed && (
        <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.03em' }}>
            RICO AUTO INDUSTRIES
          </div>
        </div>
      )}
    </aside>
  );
}

const headerSelectStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  color: '#f8fafc',
  padding: '6px 10px',
  borderRadius: '6px',
  fontSize: '0.84rem',
  fontWeight: 600,
  outline: 'none',
  cursor: 'pointer',
  height: '34px',
};

function TopBar({
  page,
  recording,
  settings,
  online = true,
  plc,
  hierarchyTree = [],
  selectedPlantId,
  onChangePlant,
  availableDepts = [],
  selectedDeptId,
  onChangeDept,
  availableLines = [],
  selectedLineId,
  onChangeLine,
  cameras = [],
  activeCamId,
  onSelectCamera,
  viewMode = 'single',
  onChangeViewMode,
}: {
  page: Page;
  recording: RecordingStatus;
  settings: CameraSettings;
  online?: boolean;
  plc?: PlcStatus;
  hierarchyTree?: HierarchyPlant[];
  selectedPlantId?: number | 'all';
  onChangePlant?: (id: number | 'all') => void;
  availableDepts?: any[];
  selectedDeptId?: number | 'all';
  onChangeDept?: (id: number | 'all') => void;
  availableLines?: any[];
  selectedLineId?: number | 'all';
  onChangeLine?: (id: number | 'all') => void;
  cameras?: FlatCamera[];
  activeCamId?: number | null;
  onSelectCamera?: (cam: FlatCamera) => void;
  viewMode?: 'single' | 'grid';
  onChangeViewMode?: (mode: 'single' | 'grid') => void;
}) {
  const activeCam = cameras.find(c => c.id === activeCamId) || cameras[0];
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatClock = (date: Date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const time = date.toTimeString().split(' ')[0];
    return `${day} ${month} ${year} | ${time}`;
  };

  const machineTitle = activeCam?.machine_name || 'UBE 850 T - 02';

  if (page === 'hierarchy') {
    return null;
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 28px 12px',
      background: 'transparent',
      borderBottom: '1.5px solid #e2e8f0',
      flexWrap: 'wrap',
      gap: '14px',
      marginBottom: '2px'
    }}>
      {/* Left: Machine Title + Mint Green Online Badge (matching Image 4) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          background: '#0b1e36',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#38bdf8',
          fontSize: '1.15rem'
        }}>
          ⚡
        </div>
        <h1 style={{
          fontSize: 'clamp(1.4rem, 2.2vw, 2.1rem)',
          fontWeight: 900,
          color: '#09132b',
          margin: 0,
          letterSpacing: '-0.03em',
          lineHeight: 1.1
        }}>
          {page === 'live' && viewMode === 'grid' ? 'Surveillance Multi-Grid' : machineTitle}
        </h1>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: '#dcfce7',
          color: '#15803d',
          fontSize: '0.8rem',
          fontWeight: 800,
          padding: '4px 14px',
          borderRadius: '999px',
          letterSpacing: '0.04em',
          border: '1px solid #bbf7d0'
        }}>
          <i style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}></i>
          ONLINE
        </span>

      </div>

      {/* Right: Status Pills & Admin Profile Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: recording.running ? '#dc2626' : '#f1f5f9',
          color: recording.running ? '#ffffff' : '#334155',
          border: recording.running ? '1px solid #b91c1c' : '1px solid #cbd5e1',
          fontSize: '0.78rem',
          fontWeight: 800,
          padding: '5px 14px',
          borderRadius: '999px',
          letterSpacing: '0.04em',
          boxShadow: recording.running ? '0 2px 10px rgba(220, 38, 38, 0.45)' : 'none',
          transition: 'all 0.2s ease'
        }}>
          <i style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: recording.running ? '#ffffff' : '#16a34a',
            display: 'inline-block',
            boxShadow: recording.running ? '0 0 6px #ffffff' : 'none'
          }}></i>
          {recording.running ? 'RECORDING ACTIVE' : 'RECORDING READY'}
        </span>
        <span style={{
          background: '#0b1e36',
          color: '#ffffff',
          fontSize: '0.74rem',
          fontWeight: 800,
          padding: '5px 14px',
          borderRadius: '999px',
          letterSpacing: '0.04em'
        }}>
          CH.{settings.channel || 1}
        </span>
        <div
          title="System Administrator - RICO Enterprise"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            padding: '6px 14px',
            borderRadius: '10px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            cursor: 'default',
            userSelect: 'none'
          }}
        >
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '7px',
            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            boxShadow: '0 2px 6px rgba(59, 130, 246, 0.35)'
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a', letterSpacing: '0.02em' }}>ADMIN</span>
            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b' }}>RICO Enterprise</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LivePage({
  settings,
  recording,
  online,
  plc,
  stats,
  cameras = [],
  totalCamerasCount,
  activeCamId,
  onSelectCamera,
  viewMode = 'single',
  onChangeViewMode,
  onEditCamera,
  onResetFilters,
  hierarchyTree = [],
  selectedPlantId,
  onChangePlant,
  availableDepts = [],
  selectedDeptId,
  onChangeDept,
  availableLines = [],
  selectedLineId,
  onChangeLine,
  onNavigateSaved,
}: {
  settings: CameraSettings;
  recording: RecordingStatus;
  online: boolean;
  plc?: PlcStatus;
  stats?: RecordingStats;
  cameras?: FlatCamera[];
  totalCamerasCount?: number;
  activeCamId?: number | null;
  onSelectCamera?: (cam: FlatCamera) => void;
  viewMode?: 'single' | 'grid';
  onChangeViewMode?: (mode: 'single' | 'grid') => void;
  onEditCamera?: (cam: FlatCamera) => void;
  onResetFilters?: () => void;
  hierarchyTree?: HierarchyPlant[];
  selectedPlantId?: number | 'all';
  onChangePlant?: (id: number | 'all') => void;
  availableDepts?: any[];
  selectedDeptId?: number | 'all';
  onChangeDept?: (id: number | 'all') => void;
  availableLines?: any[];
  selectedLineId?: number | 'all';
  onChangeLine?: (id: number | 'all') => void;
  onNavigateSaved?: () => void;
}) {
  const activeCam = useMemo(() => {
    return cameras.find(c => c.id === activeCamId) || cameras[0] || null;
  }, [cameras, activeCamId]);

  const liveUrl = useMemo(() => {
    if (activeCam) {
      return hierarchyCameraMjpegUrl(activeCam.id);
    }
    return mjpegUrl(settings);
  }, [activeCam, settings]);

  const [streamLoaded, setStreamLoaded] = useState(false);
  const liveFrameRef = useRef<HTMLDivElement | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStatus, setAudioStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [audioConnected, setAudioConnected] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [liveFullscreen, setLiveFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const getAudioUrl = () => {
    if (activeCam?.id) {
      return hierarchyCameraAudioUrl(activeCam.id);
    }
    const camIp = activeCam?.camera_ip || settings.ip;
    const rtspPort = activeCam?.rtsp_port || settings.rtsp_port || 554;
    const username = activeCam?.username || settings.username || 'admin';
    const password = activeCam?.password || settings.password || 'Admin@123';
    const channel = activeCam?.channel || settings.channel || 1;
    const rtspPath = activeCam?.rtsp_path || settings.rtsp_path || undefined;
    const query = new URLSearchParams({
      ip: camIp.trim(),
      rtsp_port: String(rtspPort),
      username,
      password,
      channel: String(channel),
      ...(rtspPath ? { rtsp_path: rtspPath } : {}),
      t: String(Date.now()),
    });
    return `${API_BASE}/audio.mp3?${query.toString()}`;
  };

  const toggleAudio = () => {
    const el = audioRef.current;
    if (!el) return;

    if (!audioEnabled) {
      // Turning sound ON
      setAudioEnabled(true);
      if (!audioConnected || !el.src || audioStatus === 'error') {
        // First connection: fetch stream and play
        setAudioStatus('loading');
        el.src = getAudioUrl();
        el.volume = 1.0;
        el.muted = false;
        const p = el.play();
        if (p !== undefined) {
          p.then(() => {
            setAudioStatus('playing');
            setAudioConnected(true);
          }).catch(err => {
            console.error('Audio playback error:', err);
            setAudioStatus('error');
          });
        }
      } else {
        // Stream already active in background: instant un-mute (0ms delay)
        el.muted = false;
        if (el.paused) {
          el.play().catch(() => {});
        }
        setAudioStatus('playing');
      }
    } else {
      // Turning sound OFF: Instant mute without terminating connection
      setAudioEnabled(false);
      el.muted = true;
    }
  };

  useEffect(() => {
    if (audioConnected && audioRef.current) {
      const el = audioRef.current;
      setAudioStatus('loading');
      el.src = getAudioUrl();
      el.volume = 1.0;
      el.muted = !audioEnabled;
      el.play().then(() => {
        setAudioStatus('playing');
      }).catch(() => {
        setAudioStatus('error');
      });
    }
  }, [activeCam?.id]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatLiveOverlayDate = (d: Date) => {
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    const time = d.toTimeString().split(' ')[0];
    return `${day}-${month}-${year} ${time}`;
  };

  const toggleFullscreen = () => {
    if (!liveFrameRef.current) return;
    if (!document.fullscreenElement) {
      liveFrameRef.current.requestFullscreen().then(() => setLiveFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setLiveFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFs = () => {
      setLiveFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  const currentPlant = hierarchyTree.find(p => p.id === selectedPlantId);
  const currentPlantName = selectedPlantId === 'all'
    ? 'All Plants'
    : (currentPlant?.name || 'Plant');

  const currentDept = availableDepts.find(d => d.id === selectedDeptId);
  const currentDeptName = selectedDeptId === 'all'
    ? 'All Departments'
    : (currentDept?.name || 'Department');

  const currentLine = availableLines.find(l => l.id === selectedLineId);
  const currentLineName = selectedLineId === 'all'
    ? 'All Lines'
    : (currentLine?.name || 'Line');

  const currentCamName = activeCam?.name || (cameras.length > 0 ? cameras[0].name : 'All Cameras');

  return (
    <section
      className="workbench live-workbench"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        gap: '12px',
        width: '100%',
        margin: 0,
        boxSizing: 'border-box'
      }}
    >
      {/* 1. Cascading Filter Cards + SINGLE / MULTI GRID Buttons in ONE Single Unified Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        width: '100%',
        flexWrap: 'wrap'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: viewMode === 'single' ? 'minmax(140px, 1fr) minmax(140px, 1fr) minmax(190px, 1.35fr) minmax(150px, 1.1fr)' : 'minmax(140px, 1fr) minmax(140px, 1fr) minmax(190px, 1.4fr)',
          gap: '10px',
          flex: 1,
          minWidth: 0
        }}>
          
          {/* Card 1: Plant */}
          <div
            title={`Plant: ${currentPlantName}`}
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              minWidth: 0,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
                  <path d="M17 18h1"/>
                  <path d="M12 18h1"/>
                  <path d="M7 18h1"/>
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, marginBottom: '1px', lineHeight: 1.1 }}>
                  Plant
                </span>
                <span style={{ fontSize: '0.94rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                  {currentPlantName}
                </span>
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <select
              value={selectedPlantId || 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                onChangePlant?.(val);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                zIndex: 10
              }}
            >
              <option value="all">🌐 All Plants ({hierarchyTree.length} Plants)</option>
              {hierarchyTree.map(p => (
                <option key={p.id} value={p.id}>🏭 {p.name} ({p.code})</option>
              ))}
            </select>
          </div>

          {/* Card 2: Department */}
          <div
            title={`Department: ${currentDeptName}`}
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              minWidth: 0,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, marginBottom: '1px', lineHeight: 1.1 }}>
                  Department
                </span>
                <span style={{ fontSize: '0.94rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                  {currentDeptName}
                </span>
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <select
              value={selectedDeptId || 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                onChangeDept?.(val);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                zIndex: 10
              }}
            >
              <option value="all">📁 All Departments ({availableDepts.length} Departments)</option>
              {availableDepts.map(d => {
                const p = hierarchyTree.find(item => item.id === d.plant_id);
                const prefix = (selectedPlantId === 'all' && p) ? `${p.name} → ` : '';
                return (
                  <option key={d.id} value={d.id}>{prefix}{d.name} ({d.code})</option>
                );
              })}
            </select>
          </div>

          {/* Card 3: Line */}
          <div
            title={`Line: ${currentLineName}`}
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              minWidth: 0,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                  <polyline points="16 7 22 7 22 13"/>
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, marginBottom: '1px', lineHeight: 1.1 }}>
                  Line
                </span>
                <span style={{ fontSize: currentLineName.length > 20 ? '0.86rem' : '0.94rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                  {currentLineName}
                </span>
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
            <select
              value={selectedLineId || 'all'}
              onChange={(e) => {
                const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                onChangeLine?.(val);
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                zIndex: 10
              }}
            >
              <option value="all">⚡ All Lines ({availableLines.length} Lines)</option>
              {availableLines.map(l => {
                const d = availableDepts.find(item => item.id === l.department_id);
                const prefix = (selectedDeptId === 'all' && d) ? `${d.name} → ` : '';
                return (
                  <option key={l.id} value={l.id}>{prefix}{l.name} ({l.code})</option>
                );
              })}
            </select>
          </div>

          {/* Card 4: Camera */}
          {viewMode === 'single' && (
            <div
              title={`Camera: ${currentCamName}`}
              style={{
                position: 'relative',
                background: '#ffffff',
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                minWidth: 0,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, marginBottom: '1px', lineHeight: 1.1 }}>
                    Camera
                  </span>
                  <span style={{ fontSize: '0.94rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                    {currentCamName}
                  </span>
                </div>
              </div>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <select
                value={activeCamId || ''}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const cam = cameras.find(c => c.id === id);
                  if (cam) onSelectCamera?.(cam);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  zIndex: 10
                }}
              >
                {cameras.map(c => (
                  <option key={c.id} value={c.id}>
                    📹 {c.name} · {c.machine_name} ({c.camera_ip})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* View Switcher Buttons (Exact Image 1 Design) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onChangeViewMode?.('single')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              border: viewMode === 'single' ? '1.5px solid #93c5fd' : '1.5px solid #cbd5e1',
              background: viewMode === 'single' ? '#eff6ff' : '#ffffff',
              color: viewMode === 'single' ? '#1d4ed8' : '#334155',
              fontWeight: 800,
              fontSize: '0.84rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: viewMode === 'single' ? '0 2px 8px rgba(37, 99, 235, 0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>SINGLE</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeViewMode?.('grid');
              onChangePlant?.('all');
              onChangeDept?.('all');
              onChangeLine?.('all');
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              border: viewMode === 'grid' ? '1.5px solid #93c5fd' : '1.5px solid #cbd5e1',
              background: viewMode === 'grid' ? '#eff6ff' : '#ffffff',
              color: viewMode === 'grid' ? '#1d4ed8' : '#334155',
              fontWeight: 800,
              fontSize: '0.84rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: viewMode === 'grid' ? '0 2px 8px rgba(37, 99, 235, 0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>MULTI GRID ({cameras.length || 1})</span>
          </button>

          {/* Quick Automation Status Indicator */}
          <div
            title="PLC Gate Trigger Automation Status"
            style={{
              padding: '7px 14px',
              borderRadius: '10px',
              border: '1.5px solid #cbd5e1',
              background: (settings.plc_enabled && plc?.running) ? '#f0fdf4' : '#f8fafc',
              color: (settings.plc_enabled && plc?.running) ? '#15803d' : '#64748b',
              fontWeight: 800,
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: (settings.plc_enabled && plc?.running) ? '#16a34a' : '#94a3b8'
            }}></span>
            <span>TRIGGER: {(settings.plc_enabled && plc?.running) ? 'AUTO' : 'OFF'}</span>
          </div>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <MultiCamGrid
          cameras={cameras}
          totalCamerasCount={totalCamerasCount}
          selectedCameraId={activeCamId}
          onSelectCamera={(cam) => onSelectCamera?.(cam)}
          onFocusSingle={(cam) => {
            onSelectCamera?.(cam);
            onChangeViewMode?.('single');
          }}
          onEditCamera={onEditCamera}
          onResetFilters={onResetFilters}
        />
      ) : (
        <>
          {/* Main Full-Width Widescreen Live Video Container */}
          <div
            className="live-frame"
            ref={liveFrameRef}
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: '14px',
              border: '1.5px solid #cbd5e1',
              boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
              background: '#000000',
              width: '100%',
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {/* Top Left: LIVE Badge + Machine Status Signal (Side-by-Side in Single Row) */}
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              {/* 1. LIVE Indicator */}
              <span style={{
                background: '#10b981',
                color: '#ffffff',
                border: '1.5px solid #34d399',
                padding: '5px 14px',
                borderRadius: '8px',
                fontSize: '0.86rem',
                fontWeight: 900,
                letterSpacing: '0.08em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.45)'
              }}>
                <i style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  display: 'inline-block',
                  boxShadow: '0 0 8px #ffffff'
                }}></i>
                LIVE
              </span>

              {/* 2. Machine Status Badge (Running / Minor Stoppage / Breakdown in the same place & size) */}
              {(() => {
                const timerInfo = getLiveMachineTimerSeconds(plc);
                const isBreakdown = timerInfo.state === 'breakdown';
                const isMinor = timerInfo.state === 'minor_stoppage';
                const timerText = formatTimerDisplay(timerInfo.seconds);

                if (isBreakdown) {
                  return (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'rgba(220, 38, 38, 0.95)',
                      border: '1.5px solid #fca5a5',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 4px 18px rgba(220, 38, 38, 0.6)',
                      animation: 'pulse-breakdown 1.8s infinite'
                    }}>
                      <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>🚨</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 900, color: '#fee2e2', letterSpacing: '0.04em' }}>
                        BREAKDOWN
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#fca5a5' }}>•</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#ffffff', fontFamily: 'monospace' }}>
                        ⏱ {timerText}
                      </span>
                    </div>
                  );
                }

                if (isMinor) {
                  return (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'rgba(217, 119, 6, 0.94)',
                      border: '1.5px solid #fde68a',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      backdropFilter: 'blur(8px)',
                      boxShadow: '0 4px 16px rgba(217, 119, 6, 0.5)'
                    }}>
                      <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>⚡</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 900, color: '#fef3c7', letterSpacing: '0.04em' }}>
                        STOPPAGE
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#fde68a' }}>•</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>
                        ⏱ {timerText}
                      </span>
                    </div>
                  );
                }

                // Machine running: no status badge, only stoppage/breakdown are shown here
                return null;
              })()}
            </div>

            {/* Video Image - Fills full width and height with zero distortion */}
            <LiveStreamImage
              key={liveUrl}
              src={liveUrl}
              alt={activeCam?.name || "Live camera feed"}
              onStatus={(status) => setStreamLoaded(status === 'live')}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                display: 'block'
              }}
            />

            {/* Active Live Audio Element (positioned offscreen to ensure Chrome media pipeline stays awake) */}
            <audio
              ref={audioRef}
              preload="auto"
              playsInline
              onPlaying={() => setAudioStatus('playing')}
              onWaiting={() => setAudioStatus('loading')}
              onError={(e) => {
                console.error('Audio stream error event:', e);
                setAudioStatus('error');
              }}
              style={{
                position: 'fixed',
                bottom: '-200px',
                right: '-200px',
                width: '1px',
                height: '1px',
                opacity: 0.001,
                pointerEvents: 'none'
              }}
            />

            {/* Bottom Right Floating Controls */}
            <div style={{
              position: 'absolute',
              bottom: '22px',
              right: '22px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 10
            }}>
              {/* Audio Toggle Button */}
              <button
                type="button"
                onClick={toggleAudio}
                style={{
                  background: audioEnabled ? (audioStatus === 'error' ? '#ef4444' : '#10b981') : 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(12px)',
                  border: audioEnabled ? 'none' : '1.5px solid rgba(255, 255, 255, 0.22)',
                  color: '#ffffff',
                  padding: '10px 22px',
                  borderRadius: '999px',
                  fontSize: '0.96rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: audioEnabled ? '0 4px 16px rgba(16, 185, 129, 0.55)' : '0 4px 16px rgba(0,0,0,0.5)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
                title={audioEnabled ? 'Mute Live Audio Feed' : 'Unmute Live Audio Feed'}
              >
                <span style={{ fontSize: '1.2rem' }}>
                  {audioEnabled
                    ? (audioStatus === 'loading' ? '⏳' : audioStatus === 'error' ? '⚠️' : '🔊')
                    : '🔇'}
                </span>
                <span>
                  {audioEnabled
                    ? (audioStatus === 'loading' ? 'Connecting Audio...' : audioStatus === 'error' ? 'Audio Error (Retry)' : 'Audio ON')
                    : 'Audio OFF'}
                </span>
              </button>

              {/* Fullscreen Circular Button */}
              <button
                type="button"
                onClick={toggleFullscreen}
                style={{
                  background: 'rgba(30, 41, 59, 0.88)',
                  backdropFilter: 'blur(12px)',
                  border: '1.5px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  transition: 'all 0.2s ease'
                }}
                title={liveFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                <span>⛶</span>
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SavedPage({
  page: activeAppPage,
  settings,
  refreshToken,
  stats,
  plc,
  onEditReason,
  userRole,
}: {
  page: Page;
  settings: CameraSettings;
  refreshToken: number;
  stats: RecordingStats;
  plc: PlcStatus;
  onEditReason: (record: RecordingRecord) => void;
  userRole: UserRole;
}) {
  const [page, setPage] = useState(1);
  const [expandedRowPaths, setExpandedRowPaths] = useState<Record<string, boolean>>({});
  const [datePreset, setDatePreset] = useState<ReportDatePreset>('today');
  const [fromDate, setFromDate] = useState(todayInputValue());
  const [toDate, setToDate] = useState(todayInputValue());
  const [category, setCategory] = useState('all');
  const [shift, setShift] = useState<ReportShift>('all');
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>({
    datePreset: 'today',
    fromDate: todayInputValue(),
    toDate: todayInputValue(),
    category: 'all',
    shift: 'all',
  });
  const [reportStats, setReportStats] = useState<RecordingStats>(stats);
  const [list, setList] = useState<RecordingList>({ total: 0, page: 1, page_size: PAGE_SIZE, records: [] });
  const [latest, setLatest] = useState<RecordingRecord | null>(null);
  const [selected, setSelected] = useState<RecordingRecord | null>(null);

  const activeBusinessRange = useMemo(
    () => businessDateTimeRange(presetDateRange(appliedFilters.datePreset, appliedFilters.fromDate, appliedFilters.toDate)),
    [appliedFilters.datePreset, appliedFilters.fromDate, appliedFilters.toDate],
  );
  const filtersDirty = (
    appliedFilters.datePreset !== datePreset
    || appliedFilters.fromDate !== fromDate
    || appliedFilters.toDate !== toDate
    || appliedFilters.category !== category
    || appliedFilters.shift !== shift
  );


  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const [playingPath, setPlayingPath] = useState('');
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingPlayPathRef = useRef<string | null>(null);
  const videoLoadRetryRef = useRef(0);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [videoRetryNonce, setVideoRetryNonce] = useState(0);
  const [editingReason, setEditingReason] = useState(false);
  const [editingReasonRecord, setEditingReasonRecord] = useState<RecordingRecord | null>(null);
  const [editReasonText, setEditReasonText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubReason, setSelectedSubReason] = useState('');
  const [editNoteText, setEditNoteText] = useState('');
  const [editResponsibility, setEditResponsibility] = useState('Maintenance');
    const [editPerson, setEditPerson] = useState('');
    const [editStatus, setEditStatus] = useState('Pending');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editManualTranscript, setEditManualTranscript] = useState('');
  const [savingReason, setSavingReason] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [openStep, setOpenStep] = useState(1);
  const [stepSearch, setStepSearch] = useState('');
  const [isModalMaximized, setIsModalMaximized] = useState(true);

  function editRecord(record: RecordingRecord, viewMode = false) {
    setIsViewMode(viewMode);
    setEditingReasonRecord(record);
    
    // Parse category and subcategory from reason string
    const reasonParts = (record.reason || '').split(' - ');
    const rawType = (reasonParts[0] || '').trim();
    const isStandardType = DOWNTIME_TYPES.includes(rawType);

    setEditReasonText(isStandardType ? rawType : '');
    setSelectedCategory(isStandardType ? (reasonParts[1] || '').trim() : '');
    setSelectedSubReason(isStandardType ? (reasonParts[2] || '').trim() : '');

    // Parse note fields
    let resp = 'Maintenance', person = '', date = '', actionNote = '';
    if (record.reason_note) {
      const parts = record.reason_note.split(' | ');
      for (const p of parts) {
        if (p.startsWith('Responsibility: ')) resp = p.replace('Responsibility: ', '');
        else if (p.startsWith('Person: ')) person = p.replace('Person: ', '');
        else if (p.startsWith('Target Date: ')) date = p.replace('Target Date: ', '');
        else if (p.startsWith('Action: ')) actionNote = p.replace('Action: ', '');
      }
    } else {
      actionNote = record.reason_note || (!isStandardType && record.reason ? record.reason : '');
    }

    setEditResponsibility(resp);
    setEditPerson(person);
    setEditTargetDate(date);
    setEditNoteText(actionNote);
    setEditManualTranscript(record.manual_transcript || '');
    setStepSearch('');
    setOpenStep(isStandardType ? (reasonParts[1] ? (reasonParts[2] ? 4 : 3) : 2) : 1);
  }
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [isVideoBuffering, setIsVideoBuffering] = useState(false);
  const audioFadeRafRef = useRef<number | null>(null);
  // Volume the user chose with the player controls; the start-of-video ramp ends there, not at 100%.
  const userVolumeRef = useRef(1);

  const applySmoothAudioRamp = (player: HTMLVideoElement) => {
    if (audioFadeRafRef.current) {
      cancelAnimationFrame(audioFadeRafRef.current);
      audioFadeRafRef.current = null;
    }
    const targetVol = userVolumeRef.current;
    // If the video is playing past 1.5 seconds, leave volume where the user set it
    if (player.currentTime > 1.5) {
      player.volume = targetVol;
      return;
    }

    // Avoid a sudden blast of machine noise when playback starts: ramp up over 750 ms
    const startVol = Math.min(0.05, targetVol);
    const durationMs = 750;
    player.volume = startVol;
    const startT = performance.now();

    const step = (now: number) => {
      const elapsed = now - startT;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      const vol = startVol + (targetVol - startVol) * eased;
      if (player) {
        player.volume = Math.min(Math.max(vol, 0), 1);
      }
      if (progress < 1 && !player.paused) {
        audioFadeRafRef.current = requestAnimationFrame(step);
      } else {
        audioFadeRafRef.current = null;
      }
    };
    audioFadeRafRef.current = requestAnimationFrame(step);
  };

  function changeDatePreset(value: ReportDatePreset) {
    setDatePreset(value);
    const range = presetDateRange(value, fromDate, toDate);
    const nFrom = range?.fromDate || fromDate;
    const nTo = range?.toDate || toDate;
    if (range && value !== 'custom') {
      setFromDate(nFrom);
      setToDate(nTo);
      setAppliedFilters(prev => ({
        ...prev,
        datePreset: value,
        fromDate: nFrom,
        toDate: nTo,
      }));
      setPage(1);
    }
  }

  function handleCategoryChange(newCat: string) {
    setCategory(newCat);
    setAppliedFilters(prev => ({ ...prev, category: newCat }));
    setPage(1);
  }

  function handleShiftChange(newShift: ReportShift) {
    setShift(newShift);
    setAppliedFilters(prev => ({ ...prev, shift: newShift }));
    setPage(1);
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
      shift,
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
      if (activeBusinessRange) {
        payload.start_at = activeBusinessRange.startAt;
        payload.end_at = activeBusinessRange.endAt;
      }
      if (appliedFilters.category !== 'all') {
        payload.event_type = appliedFilters.category;
      }
      if (appliedFilters.shift !== 'all') {
        payload.shift = appliedFilters.shift;
      }
      const endpoint = refreshIndex ? '/recording-index/scan' : '/recording-index/list';
      const [data, statsData] = await Promise.all([
        postJson<RecordingList>(endpoint, payload),
        postJson<RecordingStats>('/recording-index/stats', payload),
      ]);
      const nextTotalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
      if (page > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      const records = (data.records || []).slice(0, PAGE_SIZE);
      setList({ ...data, records });
      setReportStats(statsData);

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
    appliedFilters.shift,
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
  function recordStorageRoot(record: RecordingRecord) {
    return record.storage_root || settings.storage_root;
  }

  const selectedVideoUrl = useMemo(
    () => selected && videoReady(selected)
      ? `${recordingFileUrl(recordStorageRoot(selected), selected.file_path)}&v=${encodeURIComponent(String(selected.file_size || selected.updated_at || selected.ended_at || '0'))}&retry=${videoRetryNonce}`
      : '',
    [selected, settings.storage_root, videoRetryNonce],
  );

  useEffect(() => {
    if (!selectedVideoUrl || !playerRef.current) return;
    playerRef.current.pause();
    setPlayingPath('');
    setPlaybackState('loading');
    setIsVideoBuffering(true);
    playerRef.current.load();
  }, [selectedVideoUrl]);

  useEffect(() => {
    function onFullscreenChange() {
      setPlayerFullscreen(document.fullscreenElement === playerWrapRef.current);
      if (!document.fullscreenElement) {
        if (audioFadeRafRef.current) {
          cancelAnimationFrame(audioFadeRafRef.current);
          audioFadeRafRef.current = null;
        }
        playerRef.current?.pause();
        setPlaybackState('idle');
        setIsVideoBuffering(false);
        setSelected(null);
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function enterPlayerFullscreen() {
    const target = playerWrapRef.current;
    if (!target || document.fullscreenElement === target) return;
    await target.requestFullscreen();
  }

  function startPlayer(path = selected?.file_path, showError = true) {
    const player = playerRef.current;
    if (!player || !path) return;
    player.play().catch(() => {
      if (showError && pendingPlayPathRef.current === path) {
        pendingPlayPathRef.current = null;
        setPlayingPath('');
        setPlaybackState('error');
        setIsVideoBuffering(false);
      }
    });
  }

  function playRecord(record: RecordingRecord) {
    setError('');
    setPlayingPath('');
    setPlaybackState('loading');
    setIsVideoBuffering(true);
    videoLoadRetryRef.current = 0;
    setVideoRetryNonce((value) => value + 1);
    pendingPlayPathRef.current = record.file_path;
    flushSync(() => {
      setSelected({ ...record });
    });
    setEditingReason(false);
    setEditReasonText(record.reason || '');
    setEditNoteText(record.reason_note || '');
    enterPlayerFullscreen()
      .catch(() => setError('Fullscreen was blocked by the browser. Video is ready on the page; click Play again.'))
      .finally(() => window.setTimeout(() => startPlayer(record.file_path, false), 0));
  }

  function retrySelectedVideo() {
    if (!selected) return;
    setError('');
    setPlayingPath('');
    setPlaybackState('loading');
    setIsVideoBuffering(true);
    videoLoadRetryRef.current = 0;
    pendingPlayPathRef.current = selected.file_path;
    setVideoRetryNonce((value) => value + 1);
    window.setTimeout(() => startPlayer(selected.file_path, false), 250);
  }

  function toggleSelectedPlayback() {
    const player = playerRef.current;
    if (!player || !selected || playbackState === 'loading' || playbackState === 'error') return;
    if (player.paused || player.ended) {
      pendingPlayPathRef.current = selected.file_path;
      startPlayer(selected.file_path);
      return;
    }
    player.pause();
  }

  async function togglePlayerFullscreen() {
    const target = playerWrapRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen toggle failed:', err);
    }
  }

  async function saveEditedReason(record: RecordingRecord) {
    setSavingReason(true);
    try {
      const parts = [editReasonText, selectedCategory, selectedSubReason].filter(Boolean);
      let newReason = parts.join(' - ');
      const fullNote = [
        editResponsibility ? `Responsibility: ${editResponsibility}` : '',
        editPerson ? `Person: ${editPerson}` : '',
        editTargetDate ? `Target Date: ${editTargetDate}` : '',
        editNoteText ? `Action: ${editNoteText}` : ''
      ].filter(Boolean).join(' | ');

      await postJson('/recording-reason', {
        storage_root: recordStorageRoot(record),
        file_path: record.file_path,
        event_started_at: record.event_started_at,
        event_type: record.event_type || 'minor_stoppage',
        reason: newReason.trim(),
        note: fullNote || undefined,
        submitted_by: 'Operator (Correction)',
        manual_transcript: editManualTranscript.trim() || undefined,
          status: editStatus,
        });

      if (selected?.file_path === record.file_path) {
        setSelected((current) => (current ? {
          ...current,
          reason: newReason.trim(),
          reason_note: fullNote || null,
          reason_submitted_by: 'Operator (Correction)',
          reason_submitted_at: new Date().toISOString().substring(0, 19),
          manual_transcript: editManualTranscript.trim() || null,
        } : null));
      }

      setList((current) => ({
        ...current,
        records: current.records.map((r) => (r.file_path === record.file_path ? {
          ...r,
          reason: newReason.trim(),
          reason_note: fullNote || null,
          reason_submitted_by: 'Operator (Correction)',
          reason_submitted_at: new Date().toISOString().substring(0, 19),
          manual_transcript: editManualTranscript.trim() || null,
        } : r)),
      }));

      setEditingReasonRecord(null);
    } catch (exc) {
      console.error('Failed to update reason:', exc);
      alert('Failed to save reason. Please reload and try again.');
    } finally {
      setSavingReason(false);
    }
  }

  const latestOpenBreakdownPath = stats.latest_event?.event_type === 'breakdown' ? stats.latest_event.file_path : latest?.event_type === 'breakdown' ? latest.file_path : null;
  const exportUrl = useMemo(() => recordingExportUrl({
    storage_root: settings.storage_root,
    start_at: activeBusinessRange?.startAt,
    end_at: activeBusinessRange?.endAt,
    event_type: appliedFilters.category !== 'all' ? appliedFilters.category : undefined,
    shift: appliedFilters.shift !== 'all' ? appliedFilters.shift : undefined,
    public_helper_url: settings.public_helper_url,
  }), [activeBusinessRange, appliedFilters.category, appliedFilters.shift, settings.public_helper_url, settings.storage_root]);

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

  function liveStatus(record: RecordingRecord) {
    if (isRecordingOpen(record)) return 'Running';
    if (record.event_type === 'breakdown' && !record.event_ended_at) return 'Running';
    if (isOpenBreakdown(record)) return 'Running';
    return clipStatus(record);
  }

  return (
    <section className={selected ? 'workbench saved-workbench active-player' : 'workbench saved-workbench'} style={{ padding: '12px 28px 24px', background: '#f8fafc' }}>
      <div className="library-column" style={{ width: '100%' }}>
        <header className="er-header">
          <div className="er-title">
            <span className="er-title-icon"><Icon name="file" /></span>
            <div>
              <h1>Incident &amp; Event Report</h1>
              <p>Machine stoppages and breakdowns with video, downtime reason and voice notes.</p>
            </div>
          </div>
          <div className="er-header-actions">
            <button type="button" className="er-btn er-btn-secondary" onClick={() => load(true)} disabled={loading}>
              <Icon name="reload" /> {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <a className="er-btn er-btn-primary" href={exportUrl} download>
              <Icon name="download" /> Export Excel
            </a>
          </div>
        </header>

        <KpiCards stats={reportStats} thresholdSeconds={settings.max_record_seconds} />

        <div className="er-filters">
          <label className="er-field">
            <span>Date range</span>
            <select value={datePreset} onChange={(event) => changeDatePreset(event.target.value as ReportDatePreset)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_7">Last 7 days</option>
              <option value="last_15">Last 15 days</option>
              <option value="custom">Custom range</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label className="er-field">
            <span>From</span>
            <DateInputDDMMYYYY disabled={datePreset !== 'custom'} value={fromDate} onChange={setFromDate} />
          </label>
          <label className="er-field">
            <span>To</span>
            <DateInputDDMMYYYY disabled={datePreset !== 'custom'} value={toDate} onChange={setToDate} />
          </label>
          <label className="er-field">
            <span>Category</span>
            <select value={category} onChange={(event) => handleCategoryChange(event.target.value)}>
              <option value="all">All categories</option>
              <option value="minor_stoppage">Minor stoppage (&lt; {stoppageThresholdLabel(settings.max_record_seconds)})</option>
              <option value="breakdown">Breakdown (&gt; {stoppageThresholdLabel(settings.max_record_seconds)})</option>
            </select>
          </label>
          <label className="er-field">
            <span>Shift</span>
            <select value={shift} onChange={(event) => handleShiftChange(event.target.value as ReportShift)}>
              <option value="all">All shifts</option>
              <option value="A">Shift A</option>
              <option value="B">Shift B</option>
              <option value="C">Shift C</option>
            </select>
          </label>
          <div className="er-filter-actions">
            <button
              type="button"
              className="er-btn er-btn-secondary"
              onClick={() => {
                setDatePreset('today');
                setFromDate(todayInputValue());
                setToDate(todayInputValue());
                setCategory('all');
                setShift('all');
                setAppliedFilters({
                  datePreset: 'today',
                  fromDate: todayInputValue(),
                  toDate: todayInputValue(),
                  category: 'all',
                  shift: 'all',
                });
                load(true);
              }}
            >
              Reset
            </button>
            <button type="button" className="er-btn er-btn-primary" onClick={applyFilters} disabled={!filtersDirty || loading}>
              <Icon name="filter" /> Apply filters
            </button>
          </div>
        </div>

        <>
            {error && <div className="error-banner">{error}</div>}

            <section className="er-table-card">
              <div className="er-table-toolbar">
                <strong>Events</strong>
                <span>{reportRangeSummary(appliedFilters)} · {list.total} {list.total === 1 ? 'event' : 'events'}</span>
              </div>

              {!loading && list.records.length === 0 ? (
                <div className="er-empty">
                  <strong>No events found</strong>
                  <span>No stoppage was recorded for the selected filters. Change the date range or category and apply again.</span>
                </div>
              ) : (
                <div className="er-table-scroll">
                  <div className="er-table" role="table" aria-label="Machine events">
                    <div className="er-row er-head" role="row">
                      <span role="columnheader">#</span>
                      <span role="columnheader">Event time</span>
                      <span role="columnheader">Duration</span>
                      <span role="columnheader">Category</span>
                      <span role="columnheader">Downtime reason</span>
                      <span role="columnheader">Voice note</span>
                      <span role="columnheader">Status</span>
                      <span role="columnheader" className="er-col-actions">Actions</span>
                    </div>

                    {list.records.map((record, index) => {
                      const status = liveStatus(record);
                      const canPlay = videoReady(record) || hasVideo(record);
                      const serialNumber = (page - 1) * PAGE_SIZE + index + 1;
                      const isBreakdown = record.event_type === 'breakdown';
                      const hasReason = Boolean(record.reason_submitted_by && record.reason_submitted_by !== 'Voice Transcript');
                      const inProgress = status === 'Running';
                      const endText = liveEventEnd(record) === 'Running' ? 'In progress' : formatTimeOnly(eventEnd(record));
                      const voiceText = record.manual_transcript || record.transcript;

                      return (
                        <div className={isBreakdown ? 'er-row er-row-breakdown' : 'er-row'} role="row" key={record.file_path}>
                          <span className="er-serial">{serialNumber}</span>

                          <span className="er-time" title={record.file_name}>
                            <strong>{formatDateOnly(eventStart(record))}</strong>
                            <small>{formatTimeOnly(eventStart(record))} → {endText}</small>
                          </span>

                          <span className="er-duration">
                            <strong>{formatDuration(liveBreakdownDuration(record))}</strong>
                            <small>Video {record.duration_seconds ? formatDuration(record.duration_seconds) : '—'}</small>
                          </span>

                          <span>
                            <span className={isBreakdown ? 'er-badge er-badge-red' : 'er-badge er-badge-amber'}>
                              <i aria-hidden="true" />
                              {isBreakdown ? 'Breakdown' : 'Minor stoppage'}
                            </span>
                          </span>

                          <span>
                            {hasReason ? (
                              <button type="button" className="er-reason" onClick={() => editRecord(record, false)} title={`${record.reason || ''} — click to edit`}>
                                <span>{record.reason?.split(' - ').pop() || record.reason}</span>
                                <Icon name="edit" />
                              </button>
                            ) : (
                              <button type="button" className="er-reason er-reason-pending" onClick={() => editRecord(record, false)} title="Add downtime reason">
                                <Icon name="edit" />
                                <span>Add reason</span>
                              </button>
                            )}
                          </span>

                          <span className="er-voice" title={voiceText || undefined}>
                            {voiceText ? (
                              <>
                                <Icon name="mic" />
                                <span>{voiceText}</span>
                                {record.manual_transcript && <em>Edited</em>}
                              </>
                            ) : (
                              <span className="er-muted">No speech detected</span>
                            )}
                          </span>

                          <span>
                            <span className={inProgress ? 'er-status er-status-amber' : record.error ? 'er-status er-status-red' : 'er-status er-status-green'}>
                              {inProgress ? 'In progress' : record.error ? 'Error' : 'Completed'}
                            </span>
                          </span>

                          <span className="er-actions er-col-actions">
                            {canPlay ? (
                              <>
                                <button type="button" className="er-btn er-btn-play" onClick={() => playRecord(record)} title="Play event video">
                                  <Icon name="play" /> <span className="er-play-label">Play</span>
                                </button>
                                <a
                                  className="er-icon-btn"
                                  href={recordingFileUrl(recordStorageRoot(record), record.file_path, true)}
                                  download={record.file_name || 'event_recording.mp4'}
                                  title="Download video"
                                  aria-label="Download video"
                                >
                                  <Icon name="download" />
                                </a>
                              </>
                            ) : (
                              <span className="er-muted">No video</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {list.records.length > 0 && (
                <footer className="er-pagination">
                  <span>
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, list.total)} of {list.total}
                  </span>
                  <nav aria-label="Pagination">
                    <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                    {paginationItems(page, totalPages).map((item, i) =>
                      item === 'gap' ? (
                        <span key={`gap-${i}`} className="er-page-gap">…</span>
                      ) : (
                        <button
                          type="button"
                          key={item}
                          className={item === page ? 'is-active' : undefined}
                          aria-current={item === page ? 'page' : undefined}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </button>
                      )
                    )}
                    <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
                  </nav>
                </footer>
              )}
            </section>
        </>
      </div>

      {selected && videoReady(selected) && (
        <div className="record-player-wrap report-fullscreen-player" ref={playerWrapRef} aria-hidden={!playerFullscreen}>
          <div className="modal-player-card">
            <div className="modal-video-container">
              <div className="video-player-toolbar">
                <button
                  type="button"
                  className={`toolbar-btn reload-btn ${isVideoBuffering || playbackState === 'loading' ? 'is-spinning' : ''}`}
                  title="Reload video"
                  onClick={retrySelectedVideo}
                >
                  <Icon name="reload" />
                </button>
                <button
                  type="button"
                  className="toolbar-btn close-btn"
                  title="Close player (Esc)"
                  onClick={() => {
                    if (audioFadeRafRef.current) {
                      cancelAnimationFrame(audioFadeRafRef.current);
                      audioFadeRafRef.current = null;
                    }
                    if (document.fullscreenElement) {
                      document.exitFullscreen().catch(() => {});
                    }
                    setSelected(null);
                    setIsVideoBuffering(false);
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>

              {/* Professional Full-Page / Modal Reloading & Buffering State */}
              {(isVideoBuffering || playbackState === 'loading') && (
                <div className="video-fullscreen-loader" aria-live="polite">
                  <div className="loader-backdrop-glow" />
                  <div className="loader-box">
                    <div className="loader-spinner-container">
                      <div className="loader-ring-pulse" />
                      <div className="loader-ring-orbit" />
                      <div className="loader-center-badge">
                        <Icon name="reload" />
                      </div>
                    </div>
                    <div className="loader-status-container">
                      <h3 className="loader-headline">Loading Video Recording</h3>
                      <p className="loader-subtext">Buffering high-definition stream &bull; Calibrating audio</p>
                      {selected.file_name && (
                        <div className="loader-file-chip">
                          <Icon name="file" />
                          <span className="file-chip-name">{selected.file_name}</span>
                        </div>
                      )}
                    </div>
                    <div className="loader-progress-bar">
                      <div className="loader-progress-fill" />
                    </div>
                  </div>
                </div>
              )}

              {/* Playback Error State */}
              {playbackState === 'error' && (
                <div className="video-fullscreen-loader is-error" aria-live="assertive">
                  <div className="loader-box error-box">
                    <div className="loader-error-badge">
                      <Icon name="alert" />
                    </div>
                    <div className="loader-status-container">
                      <h3 className="loader-headline text-danger">Playback Unavailable</h3>
                      <p className="loader-subtext">{error || 'Could not stream recording. Click reload to retry.'}</p>
                    </div>
                    <div className="loader-action-buttons">
                      <button
                        type="button"
                        className="er-btn er-btn-primary retry-action-btn"
                        onClick={retrySelectedVideo}
                      >
                        <Icon name="reload" /> <span>Reload Stream</span>
                      </button>
                      <button
                        type="button"
                        className="er-btn er-btn-ghost"
                        onClick={() => {
                          if (document.fullscreenElement) {
                            document.exitFullscreen().catch(() => {});
                          }
                          setSelected(null);
                        }}
                      >
                        <Icon name="close" /> <span>Close</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <video
                ref={playerRef}
                key={selected.file_path}
                className="record-player"
                src={selectedVideoUrl}
                controls
                autoPlay
                controlsList="nofullscreen"
                disablePictureInPicture
                preload="auto"
                onLoadStart={() => {
                  setIsVideoBuffering(true);
                }}
                onWaiting={() => {
                  setIsVideoBuffering(true);
                }}
                onCanPlay={() => {
                  setIsVideoBuffering(false);
                }}
                onPlaying={() => {
                  setIsVideoBuffering(false);
                  setPlaybackState('ready');
                  videoLoadRetryRef.current = 0;
                  if (playerRef.current) {
                    applySmoothAudioRamp(playerRef.current);
                  }
                }}
                onPlay={() => {
                  setPlaybackState('ready');
                  videoLoadRetryRef.current = 0;
                  if (playerRef.current) {
                    applySmoothAudioRamp(playerRef.current);
                  }
                }}
                onVolumeChange={() => {
                  if (!audioFadeRafRef.current && playerRef.current) userVolumeRef.current = playerRef.current.volume;
                }}
                onSeeked={() => {
                  if (playerRef.current && playerRef.current.currentTime < 1.0) {
                    applySmoothAudioRamp(playerRef.current);
                  }
                }}
                onError={() => {
                  setIsVideoBuffering(false);
                  if (videoLoadRetryRef.current < 2) {
                    videoLoadRetryRef.current += 1;
                    retrySelectedVideo();
                    return;
                  }
                  setPlaybackState('error');
                  setError('Playback error. Click Reload or verify camera connectivity.');
                }}
              />
            </div>
          </div>
        </div>
      )}
      {editingReasonRecord && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            zIndex: 9999,
            padding: 0,
            margin: 0
          }}
          onClick={() => setEditingReasonRecord(null)}
        >
          <div
            style={{
              background: '#ffffff',
              border: 'none',
              borderRadius: 0,
              width: '100vw',
              maxWidth: '100vw',
              height: '100vh',
              maxHeight: '100vh',
              boxShadow: 'none',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '14px 28px',
              background: '#f8fafc',
              borderBottom: '1.5px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              flexShrink: 0
            }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.12em', color: '#2563eb', textTransform: 'uppercase', marginBottom: '3px' }}>
                  🏭 RICO AUTO INDUSTRIES • OFFICIAL TPM EVENT REPORT
                </div>
                <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  EVENT REPORT & ROOT CAUSE DETAILS (OPERATOR ENTRY)
                </h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{
                  background: editingReasonRecord.event_type === 'breakdown' ? '#fee2e2' : '#d1fae5',
                  color: editingReasonRecord.event_type === 'breakdown' ? '#dc2626' : '#059669',
                  border: editingReasonRecord.event_type === 'breakdown' ? '1.5px solid #fecaca' : '1.5px solid #a7f3d0',
                  padding: '6px 16px',
                  borderRadius: '9999px',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  {editingReasonRecord.event_type === 'breakdown' ? '🚨 BREAKDOWN' : '⚡ MINOR STOPPAGE'}
                </span>
                <span style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  color: '#1e293b',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.84rem',
                  fontWeight: 700
                }}>
                  ⏱ {formatDuration(liveBreakdownDuration(editingReasonRecord))}
                </span>
                <span style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  color: '#1e293b',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.84rem',
                  fontWeight: 600
                }}>
                  📅 {formatDateTime(editingReasonRecord.started_at)}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingReasonRecord(null)}
                  style={{
                    background: '#ef4444',
                    border: 'none',
                    color: '#ffffff',
                    padding: '7px 18px',
                    borderRadius: '8px',
                    fontSize: '0.86rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Modal Body - 2-Column Industrial Split Workspace */}
            <div style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 380px) 1fr',
              gap: '20px',
              padding: '18px 24px',
              overflow: 'hidden',
              background: '#ffffff'
            }}>
              {/* 👈 LEFT COLUMN: Context, Remarks, and Action Plan & 5-Why RCA */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                overflowY: 'auto',
                paddingRight: '6px'
              }}>
                {/* Left Card 1: AI Speech Context */}
                <div style={{
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '12px',
                  background: '#f8fafc',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{
                      fontSize: '0.74rem',
                      fontWeight: 900,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      color: '#2563eb',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '6px',
                      padding: '2px 8px'
                    }}>
                      🎙 AI SPEECH CONTEXT
                    </span>
                    <span style={{
                      background: editingReasonRecord.transcript ? '#d1fae5' : '#f1f5f9',
                      color: editingReasonRecord.transcript ? '#059669' : '#64748b',
                      border: editingReasonRecord.transcript ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '0.74rem',
                      fontWeight: 800
                    }}>
                      {editingReasonRecord.transcript ? '● Speech Recorded' : '○ No Voice Recorded'}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Voice Transcript
                    </div>
                    <div style={{
                      background: '#ffffff',
                      border: '1.5px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '0.88rem',
                      minHeight: '44px',
                      color: editingReasonRecord.transcript ? '#0f172a' : '#64748b',
                      fontStyle: editingReasonRecord.transcript ? 'normal' : 'italic',
                      lineHeight: '1.45',
                      wordBreak: 'break-word',
                      boxSizing: 'border-box'
                    }}>
                      {editingReasonRecord.transcript || 'No voice detected during this event duration.'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#ea580c', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Operator Remarks / Correction
                    </div>
                    <textarea
                      value={editManualTranscript}
                      onChange={(e) => setEditManualTranscript(e.target.value)}
                      placeholder="Type verified operator remarks..."
                      style={{
                        width: '100%',
                        minHeight: '44px',
                        background: '#ffffff',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        fontSize: '0.88rem',
                        color: '#0f172a',
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit'
                      }}
                    />
                  </div>
                </div>

                {/* Left Card 2: Action Plan & 5-Why RCA Notes */}
                <div style={{
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '12px',
                  background: '#f8fafc',
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  flex: 1
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                    <span style={{
                      fontSize: '0.74rem',
                      fontWeight: 900,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      color: '#10b981',
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '6px',
                      padding: '2px 8px'
                    }}>
                      📋 ACTION PLAN & RCA
                    </span>
                    <span style={{ fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
                      Ownership & Root Cause Countermeasures
                    </span>
                  </div>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.84rem', fontWeight: 800, color: '#334155' }}>
                    <span>👤 HOD / ASSIGNED PERSON</span>
                    <input
                      type="text"
                      disabled={savingReason || isViewMode}
                      placeholder="e.g. Ashutosh Pandey"
                      value={editPerson}
                      onChange={e => setEditPerson(e.target.value)}
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        color: '#0f172a',
                        fontSize: '0.96rem',
                        fontWeight: 600,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.84rem', fontWeight: 800, color: '#334155' }}>
                      <span>📌 RESOLUTION STATUS</span>
                      <select
                        disabled={savingReason || isViewMode}
                        value={editStatus}
                        onChange={e => setEditStatus(e.target.value)}
                        style={{
                          background: '#ffffff',
                          border: '1.5px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          color: '#0f172a',
                          fontSize: '0.92rem',
                          fontWeight: 600,
                          outline: 'none',
                          boxSizing: 'border-box',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="Pending">⏳ Pending</option>
                        <option value="In Progress">🔄 In Progress</option>
                        <option value="Completed">✅ Completed</option>
                      </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.84rem', fontWeight: 800, color: '#334155' }}>
                      <span>📅 TARGET DATE</span>
                      <input
                        type="date"
                        disabled={savingReason || isViewMode}
                        value={editTargetDate}
                        onChange={e => setEditTargetDate(e.target.value)}
                        style={{
                          background: '#ffffff',
                          border: '1.5px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          color: '#0f172a',
                          fontSize: '0.92rem',
                          fontWeight: 600,
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#d97706', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      🛠 5-WHY ROOT CAUSE ANALYSIS (RCA) & ACTIONS
                    </div>
                    <textarea
                      disabled={savingReason || isViewMode}
                      value={editNoteText}
                      onChange={e => setEditNoteText(e.target.value)}
                      placeholder="Enter verified 5-Why root cause analysis notes, corrective actions taken, preventive countermeasures..."
                      style={{
                        width: '100%',
                        minHeight: '125px',
                        flex: 1,
                        background: '#ffffff',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        fontSize: '0.94rem',
                        lineHeight: '1.55',
                        color: '#0f172a',
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* 👉 RIGHT COLUMN: Interactive Hierarchy Reason Finder */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                overflow: 'hidden',
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '14px',
                padding: '18px 20px'
              }}>
                {/* 1. Step Navigation Stepper Tabs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', width: '100%' }}>
                  {/* Step 1 Tab */}
                  <button
                    type="button"
                    onClick={() => { setOpenStep(1); setStepSearch(''); }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: openStep === 1 ? '2.5px solid #ef4444' : editReasonText ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
                      background: openStep === 1 ? '#fee2e2' : editReasonText ? '#f0fdf4' : '#ffffff',
                      color: openStep === 1 ? '#dc2626' : editReasonText ? '#15803d' : '#64748b',
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: openStep === 1 ? '0 2px 8px rgba(239,68,68,0.2)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>STEP 1</div>
                    <div style={{ fontSize: '0.90rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={editReasonText || '1. Downtime Type'}>
                      {editReasonText ? `✓ ${editReasonText}` : '1. Downtime Type'}
                    </div>
                  </button>

                  {/* Step 2 Tab */}
                  <button
                    type="button"
                    disabled={!editReasonText}
                    onClick={() => { setOpenStep(2); setStepSearch(''); }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: openStep === 2 ? '2.5px solid #f59e0b' : selectedCategory ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
                      background: openStep === 2 ? '#fef3c7' : selectedCategory ? '#f0fdf4' : !editReasonText ? '#f8fafc' : '#ffffff',
                      color: openStep === 2 ? '#b45309' : selectedCategory ? '#15803d' : '#64748b',
                      cursor: !editReasonText ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      boxShadow: openStep === 2 ? '0 2px 8px rgba(245,158,11,0.2)' : 'none',
                      opacity: !editReasonText ? 0.6 : 1,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>STEP 2</div>
                    <div style={{ fontSize: '0.90rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedCategory || '2. Category'}>
                      {selectedCategory ? `✓ ${selectedCategory}` : '2. Category'}
                    </div>
                  </button>

                  {/* Step 3 Tab */}
                  <button
                    type="button"
                    disabled={!selectedCategory || selectedCategory === 'No Reason' || (ACTUAL_DOWNTIME_DATA[editReasonText]?.[selectedCategory] || []).length === 0}
                    onClick={() => { setOpenStep(3); setStepSearch(''); }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: openStep === 3 ? '2.5px solid #8b5cf6' : selectedSubReason ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
                      background: openStep === 3 ? '#f3e8ff' : selectedSubReason ? '#f0fdf4' : '#ffffff',
                      color: openStep === 3 ? '#7e22ce' : selectedSubReason ? '#15803d' : '#64748b',
                      cursor: (!selectedCategory || selectedCategory === 'No Reason') ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      boxShadow: openStep === 3 ? '0 2px 8px rgba(139,92,246,0.2)' : 'none',
                      opacity: (!selectedCategory || selectedCategory === 'No Reason') ? 0.6 : 1,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>STEP 3</div>
                    <div style={{ fontSize: '0.90rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedSubReason || '3. Sub-Reason'}>
                      {selectedSubReason ? `✓ ${selectedSubReason}` : '3. Sub-Reason'}
                    </div>
                  </button>

                  {/* Step 4 Tab */}
                  <button
                    type="button"
                    onClick={() => { setOpenStep(4); setStepSearch(''); }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      border: openStep === 4 ? '2.5px solid #3b82f6' : editResponsibility ? '1.5px solid #86efac' : '1.5px solid #cbd5e1',
                      background: openStep === 4 ? '#dbeafe' : editResponsibility ? '#f0fdf4' : '#ffffff',
                      color: openStep === 4 ? '#1d4ed8' : editResponsibility ? '#15803d' : '#64748b',
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: openStep === 4 ? '0 2px 8px rgba(59,130,246,0.2)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>STEP 4</div>
                    <div style={{ fontSize: '0.90rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={editResponsibility || '4. Department'}>
                      {editResponsibility ? `✓ ${editResponsibility}` : '4. Department'}
                    </div>
                  </button>
                </div>

                {/* 2. Step Header & Auto-Search Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '12px' }}>
                  <div>
                    <span style={{
                      fontSize: '0.8rem',
                      fontWeight: 800,
                      color: openStep === 1 ? '#dc2626' : openStep === 2 ? '#b45309' : openStep === 3 ? '#7e22ce' : '#1d4ed8',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em'
                    }}>
                      {openStep === 1 && 'LEVEL 1: PRIMARY CLASSIFICATION'}
                      {openStep === 2 && `LEVEL 2: FAILURE CATEGORY (${Object.keys(ACTUAL_DOWNTIME_DATA[editReasonText] || {}).length} AVAILABLE)`}
                      {openStep === 3 && `LEVEL 3: SPECIFIC SUB-REASON (${(ACTUAL_DOWNTIME_DATA[editReasonText]?.[selectedCategory] || []).length} AVAILABLE)`}
                      {openStep === 4 && 'LEVEL 4: RESPONSIBLE DEPARTMENT & HOD'}
                    </span>
                    <h3 style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                      {openStep === 1 && 'Select Downtime Type'}
                      {openStep === 2 && `Select Component / Category for "${editReasonText}"`}
                      {openStep === 3 && `Select Specific Failure Cause for "${selectedCategory}"`}
                      {openStep === 4 && 'Assign Responsible Department'}
                    </h3>
                  </div>

                  {/* Auto-Search Input (Only on searchable steps 1, 2, 3) */}
                  {openStep !== 4 && (
                    <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
                      <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '1rem', pointerEvents: 'none' }}>🔍</span>
                      <input
                        type="text"
                        placeholder={`Search ${openStep === 1 ? 'types' : openStep === 2 ? 'categories' : 'sub-reasons'}...`}
                        value={stepSearch}
                        onChange={e => setStepSearch(e.target.value)}
                        style={{
                          width: '100%',
                          height: '40px',
                          padding: '0 32px 0 36px',
                          fontSize: '0.94rem',
                          fontWeight: 600,
                          borderRadius: '8px',
                          background: '#ffffff',
                          border: '1.5px solid #cbd5e1',
                          color: '#0f172a',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      {stepSearch && (
                        <button
                          type="button"
                          onClick={() => setStepSearch('')}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            padding: '4px'
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Interactive Tiles Grid */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
                  {/* STEP 1 TILES */}
                  {openStep === 1 && (() => {
                    const filtered = DOWNTIME_TYPES.filter(o => o.toLowerCase().includes(stepSearch.toLowerCase()));
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                        {filtered.length > 0 ? filtered.map(opt => {
                          const cfg = DOWNTIME_TYPE_CONFIG[opt] || { color: '#ef4444', icon: '⚙️' };
                          const isSelected = editReasonText === opt;
                          const catCount = Object.keys(ACTUAL_DOWNTIME_DATA[opt] || {}).length;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={savingReason || isViewMode}
                              onClick={() => {
                                setEditReasonText(opt);
                                setSelectedCategory('');
                                setSelectedSubReason('');
                                setOpenStep(2);
                                setStepSearch('');
                              }}
                              style={{
                                padding: '16px 20px',
                                borderRadius: '12px',
                                border: isSelected ? '2.5px solid #ef4444' : '1.5px solid #cbd5e1',
                                background: isSelected ? '#fee2e2' : '#ffffff',
                                color: isSelected ? '#dc2626' : '#0f172a',
                                cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: isSelected ? 800 : 700,
                                textAlign: 'left',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '14px',
                                transition: 'all 0.15s ease',
                                boxShadow: isSelected ? '0 4px 16px rgba(239, 68, 68, 0.25)' : '0 1px 3px rgba(0,0,0,0.04)'
                              }}
                            >
                              <span style={{ fontSize: '1.5rem' }}>{cfg.icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '1rem', fontWeight: 800 }}>{opt}</div>
                                <div style={{ fontSize: '0.82rem', color: isSelected ? '#dc2626' : '#64748b', marginTop: '2px', fontWeight: 600 }}>
                                  {catCount} Categories
                                </div>
                              </div>
                              {isSelected && <span style={{ fontSize: '1.2rem', fontWeight: 900 }}>✓</span>}
                            </button>
                          );
                        }) : (
                          <div style={{ padding: '30px', color: '#64748b', gridColumn: '1 / -1', textAlign: 'center', fontSize: '1rem', fontWeight: 600 }}>
                            No downtime types matching "{stepSearch}"
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* STEP 2 TILES */}
                  {openStep === 2 && (() => {
                    if (!editReasonText) {
                      return (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '1rem', fontWeight: 600 }}>
                          Please select a Downtime Type first from Step 1.
                        </div>
                      );
                    }
                    const allOpts = Object.keys(ACTUAL_DOWNTIME_DATA[editReasonText] || {}).sort((a, b) => a === 'No Reason' ? -1 : b === 'No Reason' ? 1 : a.localeCompare(b));
                    const filtered = allOpts.filter(o => o.toLowerCase().includes(stepSearch.toLowerCase()));
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                        {filtered.length > 0 ? filtered.map(opt => {
                          const isSelected = selectedCategory === opt;
                          const subCount = (ACTUAL_DOWNTIME_DATA[editReasonText]?.[opt] || []).length;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={savingReason || isViewMode}
                              onClick={() => {
                                setSelectedCategory(opt);
                                setSelectedSubReason(opt === 'No Reason' ? 'No Reason' : '');
                                if (subCount > 0 && opt !== 'No Reason') {
                                  setOpenStep(3);
                                } else {
                                  setOpenStep(4);
                                }
                                setStepSearch('');
                              }}
                              style={{
                                padding: '14px 18px',
                                borderRadius: '12px',
                                border: isSelected ? '2.5px solid #f59e0b' : '1.5px solid #cbd5e1',
                                background: isSelected ? '#fef3c7' : '#ffffff',
                                color: isSelected ? '#b45309' : '#0f172a',
                                cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer',
                                fontSize: '0.96rem',
                                fontWeight: isSelected ? 800 : 700,
                                textAlign: 'left',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '10px',
                                transition: 'all 0.15s ease',
                                boxShadow: isSelected ? '0 4px 16px rgba(245, 158, 11, 0.25)' : '0 1px 3px rgba(0,0,0,0.04)'
                              }}
                            >
                              <div>
                                <div>{opt}</div>
                                {opt !== 'No Reason' && subCount > 0 && (
                                  <div style={{ fontSize: '0.78rem', color: isSelected ? '#b45309' : '#64748b', marginTop: '2px', fontWeight: 600 }}>
                                    {subCount} Sub-reasons
                                  </div>
                                )}
                              </div>
                              {isSelected && <span style={{ fontSize: '1.15rem', fontWeight: 900 }}>✓</span>}
                            </button>
                          );
                        }) : (
                          <div style={{ padding: '30px', color: '#64748b', gridColumn: '1 / -1', textAlign: 'center', fontSize: '1rem', fontWeight: 600 }}>
                            No categories matching "{stepSearch}"
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* STEP 3 TILES */}
                  {openStep === 3 && (() => {
                    if (!selectedCategory) {
                      return (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '1rem', fontWeight: 600 }}>
                          Please select a Category first from Step 2.
                        </div>
                      );
                    }
                    const allOpts = [...(ACTUAL_DOWNTIME_DATA[editReasonText]?.[selectedCategory] || [])].sort((a: string, b: string) => a.localeCompare(b));
                    const filtered = allOpts.filter((o: string) => o.toLowerCase().includes(stepSearch.toLowerCase()));
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                        {filtered.length > 0 ? filtered.map((opt: string) => {
                          const isSelected = selectedSubReason === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={savingReason || isViewMode}
                              onClick={() => {
                                setSelectedSubReason(opt);
                                setOpenStep(4);
                                setStepSearch('');
                              }}
                              style={{
                                padding: '14px 18px',
                                borderRadius: '12px',
                                border: isSelected ? '2.5px solid #8b5cf6' : '1.5px solid #cbd5e1',
                                background: isSelected ? '#f3e8ff' : '#ffffff',
                                color: isSelected ? '#7e22ce' : '#0f172a',
                                cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer',
                                fontSize: '0.96rem',
                                fontWeight: isSelected ? 800 : 700,
                                textAlign: 'left',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '10px',
                                transition: 'all 0.15s ease',
                                boxShadow: isSelected ? '0 4px 16px rgba(139, 92, 246, 0.25)' : '0 1px 3px rgba(0,0,0,0.04)'
                              }}
                            >
                              <span>{opt}</span>
                              {isSelected && <span style={{ fontSize: '1.15rem', fontWeight: 900 }}>✓</span>}
                            </button>
                          );
                        }) : (
                          <div style={{ padding: '30px', color: '#64748b', gridColumn: '1 / -1', textAlign: 'center', fontSize: '1rem', fontWeight: 600 }}>
                            No sub-reasons matching "{stepSearch}"
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* STEP 4 TILES */}
                  {openStep === 4 && (() => {
                    const departments = [
                      { name: "M/c Maintenance", color: '#3b82f6', icon: '🔧', hod: 'Ashutosh Pandey' },
                      { name: "Die-Maintenance", color: '#f97316', icon: '🔩', hod: 'S.A. Yadav' },
                      { name: "Quality",         color: '#10b981', icon: '🛡️', hod: 'Sanjay Kaul' },
                      { name: "Production",      color: '#a855f7', icon: '🏭', hod: 'Samsher Singh' }
                    ];
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
                        {departments.map(dep => {
                          const isSelected = editResponsibility === dep.name;
                          return (
                            <button
                              key={dep.name}
                              type="button"
                              disabled={savingReason || isViewMode}
                              onClick={() => {
                                setEditResponsibility(dep.name);
                                setEditPerson(dep.hod);
                              }}
                              style={{
                                padding: '16px 20px',
                                borderRadius: '12px',
                                border: isSelected ? '2.5px solid #3b82f6' : '1.5px solid #cbd5e1',
                                background: isSelected ? '#dbeafe' : '#ffffff',
                                color: isSelected ? '#1d4ed8' : '#0f172a',
                                cursor: (savingReason || isViewMode) ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: isSelected ? 800 : 700,
                                textAlign: 'left',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '14px',
                                transition: 'all 0.15s ease',
                                boxShadow: isSelected ? '0 4px 16px rgba(59, 130, 246, 0.25)' : '0 1px 3px rgba(0,0,0,0.04)'
                              }}
                            >
                              <span style={{ fontSize: '1.5rem' }}>{dep.icon}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 800, fontSize: '1.02rem' }}>{dep.name}</div>
                                <div style={{ fontSize: '0.84rem', color: isSelected ? '#1e40af' : '#64748b', marginTop: '2px', fontWeight: 600 }}>
                                  HOD: {dep.hod}
                                </div>
                              </div>
                              {isSelected && <span style={{ fontSize: '1.15rem', fontWeight: 900 }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Modal Footer - Fixed at bottom */}
            <div style={{
              padding: '16px 28px',
              background: '#f8fafc',
              borderTop: '1.5px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              flexShrink: 0
            }}>
              <div style={{ fontSize: '0.9rem', color: '#475569' }}>
                Classification: <strong style={{ color: '#2563eb' }}>{[editReasonText, selectedCategory, selectedSubReason, editResponsibility].filter(Boolean).join(' • ') || 'None selected'}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setEditingReasonRecord(null)}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    color: '#475569',
                    padding: '11px 24px',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveEditedReason(editingReasonRecord)}
                  disabled={savingReason}
                  style={{
                    background: 'linear-gradient(135deg, #059669, #047857)',
                    border: 'none',
                    color: '#ffffff',
                    padding: '11px 28px',
                    borderRadius: '8px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    cursor: savingReason ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: savingReason ? 0.7 : 1,
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {savingReason ? '💾 Saving...' : '💾 Save Event Details'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


function AccordionSection({
  step,
  title,
  color,
  selected,
  isOpen,
  onToggle,
  disabled,
  searchable,
  children
}: {
  step: string;
  title: string;
  color: string;
  selected: string;
  isOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  searchable?: boolean;
  children: ((search: string) => React.ReactNode) | React.ReactNode;
}) {
  const [search, setSearch] = useState('');

  // Reset search when closed
  useEffect(() => { if (!isOpen) setSearch(''); }, [isOpen]);

  return (
    <div
      style={{
        border: isOpen ? `2px solid ${color}` : selected ? `1.5px solid ${color}` : '1.5px solid #e2e8f0',
        borderRadius: '12px',
        overflow: 'hidden',
        background: isOpen ? '#ffffff' : selected ? '#f8fafc' : '#ffffff',
        boxShadow: isOpen ? `0 8px 24px -6px ${color}25` : '0 1px 3px rgba(0,0,0,0.03)',
        transition: 'all 0.25s ease'
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 20px',
          background: 'transparent',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.86rem',
            fontWeight: '900',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: color,
            background: color + '15',
            border: `1.5px solid ${color}40`,
            borderRadius: '6px',
            padding: '4px 10px',
            flexShrink: 0
          }}>
            STEP {step}
          </span>
          <span style={{ fontSize: '1.22rem', fontWeight: '800', color: '#0f172a' }}>
            {title}
          </span>
          {selected && !isOpen && (
            <span style={{
              fontSize: '0.98rem',
              color: color,
              background: color + '15',
              border: `1.5px solid ${color}`,
              borderRadius: '18px',
              padding: '4px 14px',
              fontWeight: '800',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              ✓ {selected}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {!selected && !isOpen && (
            <span style={{ fontSize: '0.95rem', color: '#64748b', fontWeight: '600' }}>
              Pending Selection
            </span>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isOpen ? color : '#64748b',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            flexShrink: 0,
            width: '28px',
            height: '28px'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div style={{ padding: '6px 22px 26px' }}>
          {/* Search bar */}
          {searchable && (
            <div style={{ position: 'relative', marginBottom: '14px' }}>
              <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '1.05rem', pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                autoFocus
                placeholder={`Search ${title.toLowerCase()}...`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  width: '100%',
                  height: '46px',
                  padding: '0 42px 0 44px',
                  fontSize: '1.05rem',
                  fontWeight: '600',
                  borderRadius: '12px',
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  color: '#0f172a',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.2s'
                }}
                onFocus={e => { e.target.style.borderColor = color; }}
                onBlur={e => { e.target.style.borderColor = '#cbd5e1'; }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    lineHeight: 1,
                    padding: '4px'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          {typeof children === 'function' ? children(search) : children}
        </div>
      )}
    </div>
  );
}

function TileSelector({ options, value, onChange, disabled, placeholder = "Select an option" }: { options: string[], value: string, onChange: (val: string) => void, disabled?: boolean, placeholder?: string }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const s = search.toLowerCase();
    return options
      .filter(opt => opt.toLowerCase().includes(s))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(s);
        const bStarts = b.toLowerCase().startsWith(s);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      });
  }, [options, search]);

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '14px 20px',
          borderRadius: '12px',
          border: value ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.2)',
          background: value ? 'rgba(59, 130, 246, 0.15)' : 'rgba(15, 23, 42, 0.8)',
          color: value ? 'white' : '#94a3b8',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '1.05rem',
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{ fontWeight: value ? 500 : 400, letterSpacing: '0.3px' }}>{value || placeholder}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: value ? '#93c5fd' : '#64748b' }}>
          {value && <span style={{ fontSize: '0.9rem', opacity: 0.8 }}>Selected</span>}
          <div style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'flex' }}>
            <Icon name="chevron" />
          </div>
        </div>
      </button>

      {isOpen && (
        <div style={{ 
          marginTop: '8px', 
          background: '#0f172a', 
          border: '1px solid rgba(59, 130, 246, 0.4)', 
          borderRadius: '12px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.05)',
          padding: '16px',
          display: 'flex', 
          flexDirection: 'column', 
          gap: '16px'
        }}>
          <div style={{ position: 'relative' }}>
            <input 
              type="text"
              placeholder={`Search...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '10px 16px 10px 36px', 
                fontSize: '0.95rem', 
                borderRadius: '8px', 
                background: 'rgba(30, 41, 59, 0.8)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                color: 'white', 
                outline: 'none',
                boxSizing: 'border-box'
              }}
              autoFocus
            />
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', opacity: 0.6, fontSize: '0.9rem' }}>🔍</span>
          </div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '16px', 
            overflowY: 'auto',
            paddingRight: '8px',
            paddingTop: '8px',
            maxHeight: '400px'
          }}>
            {filteredOptions.length > 0 ? filteredOptions.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                  setSearch("");
                }}
                style={{
                  padding: '24px 20px',
                  borderRadius: '16px',
                  border: opt === value ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.08)',
                  background: opt === value ? 'rgba(59, 130, 246, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                  color: opt === value ? '#ffffff' : '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: '1.15rem',
                  fontWeight: opt === value ? '700' : '600',
                  transition: 'all 0.2s ease',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: opt === value ? '0 8px 24px rgba(59, 130, 246, 0.3)' : '0 4px 6px rgba(0,0,0,0.1)',
                  minHeight: '80px'
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = opt === value ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = opt === value ? '#3b82f6' : 'rgba(255,255,255,0.2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = opt === value ? 'rgba(59, 130, 246, 0.2)' : 'rgba(30, 41, 59, 0.8)'; e.currentTarget.style.color = opt === value ? '#ffffff' : '#cbd5e1'; e.currentTarget.style.borderColor = opt === value ? '#3b82f6' : 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'none'; }}
              >
                {opt}
              </button>
            )) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '1.1rem', gridColumn: '1 / -1' }}>No options found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  // Login security bypassed: always authenticate as superadmin
  const [authenticated, setAuthenticated] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>('superadmin');
  const [page, setPage] = useState<Page>('live');
  const [settings, setSettings] = useState<CameraSettings>(() => loadSavedSettings());
  const [recording, setRecording] = useState<RecordingStatus>({ running: false, frames: 0 });
  const [plc, setPlc] = useState<PlcStatus>({ enabled: true, running: false });
  const [plcTestResult, setPlcTestResult] = useState<PlcTestResult | null>(null);
  const [stats, setStats] = useState<RecordingStats>(() => emptyStats());
  const [cameraOnline, setCameraOnline] = useState(false);
  const [message, setMessage] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsMessageTone, setSettingsMessageTone] = useState<'good' | 'bad' | 'neutral'>('neutral');
  const [adminPromptOpen, setAdminPromptOpen] = useState(false);
  const [adminPromptPassword, setAdminPromptPassword] = useState('');
  const [adminPromptError, setAdminPromptError] = useState('');
  const [adminPromptShowPassword, setAdminPromptShowPassword] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [reasonOptions, setReasonOptions] = useState<ReasonOptions>({ minor_stoppage: [], breakdown: [] });
  const [editingCamera, setEditingCamera] = useState<FlatCamera | null>(null);
  const [flatCameras, setFlatCameras] = useState<FlatCamera[]>([]);
  const [hierarchyTree, setHierarchyTree] = useState<HierarchyPlant[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState<number | 'all'>('all');
  const [selectedDeptId, setSelectedDeptId] = useState<number | 'all'>('all');
  const [selectedLineId, setSelectedLineId] = useState<number | 'all'>('all');
  const [activeCamId, setActiveCamId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  const previousRecordingRunningRef = useRef(false);
  const initialSyncRef = useRef(false);

  const handleSelectCamera = (cam: FlatCamera, syncHierarchy = true) => {
    setActiveCamId(cam.id);
    if (syncHierarchy) {
      if (cam.plant_id) setSelectedPlantId(cam.plant_id);
      if (cam.department_id) setSelectedDeptId(cam.department_id);
      if (cam.line_id) setSelectedLineId(cam.line_id);
    }
    setSettings((s) => ({
      ...s,
      ip: cam.camera_ip,
      rtsp_port: cam.rtsp_port,
      channel: cam.channel,
      rtsp_path: cam.rtsp_path,
      plc_host: cam.plc_host || s.plc_host,
      plc_port: cam.plc_port || s.plc_port,
      plc_device: cam.plc_device || s.plc_device,
      plc_address: cam.plc_address || s.plc_address,
    }));
  };

  useEffect(() => {
    let timer: any = null;
    const fetchAll = () => {
      fetchHierarchy()
        .then(data => setHierarchyTree(data))
        .catch(() => {});
      fetchFlatCameras()
        .then(data => {
          setFlatCameras(data);
          if (data.length > 0 && !initialSyncRef.current) {
            initialSyncRef.current = true;
            setActiveCamId(data[0].id);
            setSelectedPlantId(data[0].plant_id);
            setSelectedDeptId(data[0].department_id);
            setSelectedLineId(data[0].line_id);
            handleSelectCamera(data[0], true);
          }
        })
        .catch(() => {});
    };
    fetchAll();
    timer = setInterval(fetchAll, 4000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  const availableDepts = useMemo(() => {
    if (selectedPlantId === 'all') {
      return hierarchyTree.flatMap(p => p.departments);
    }
    const p = hierarchyTree.find(item => item.id === selectedPlantId);
    return p ? p.departments : [];
  }, [hierarchyTree, selectedPlantId]);

  const availableLines = useMemo(() => {
    if (selectedDeptId === 'all') {
      return availableDepts.flatMap(d => d.lines);
    }
    const d = availableDepts.find(item => item.id === selectedDeptId);
    return d ? d.lines : [];
  }, [availableDepts, selectedDeptId]);

  const filteredCameras = useMemo(() => {
    return flatCameras.filter(c => {
      if (selectedPlantId !== 'all' && c.plant_id !== selectedPlantId) return false;
      if (selectedDeptId !== 'all' && c.department_id !== selectedDeptId) return false;
      if (selectedLineId !== 'all' && c.line_id !== selectedLineId) return false;
      return true;
    });
  }, [flatCameras, selectedPlantId, selectedDeptId, selectedLineId]);

  const handleChangePlant = (val: number | 'all') => {
    setSelectedPlantId(val);
    setSelectedDeptId('all');
    setSelectedLineId('all');
    if (val !== 'all') {
      const matchCam = flatCameras.find(c => c.plant_id === val);
      if (matchCam) {
        handleSelectCamera(matchCam, false);
      }
    }
  };

  const handleChangeDept = (val: number | 'all') => {
    setSelectedDeptId(val);
    setSelectedLineId('all');
    if (val !== 'all') {
      const matchCam = flatCameras.find(c => c.department_id === val);
      if (matchCam) {
        handleSelectCamera(matchCam, false);
      }
    }
  };

  const handleChangeLine = (val: number | 'all') => {
    setSelectedLineId(val);
    if (val !== 'all') {
      const matchCam = flatCameras.find(c => c.line_id === val);
      if (matchCam) {
        handleSelectCamera(matchCam, false);
      }
    }
  };

  // Keep active camera & settings automatically in sync whenever filters change
  useEffect(() => {
    if (filteredCameras.length > 0) {
      const match = filteredCameras.find(c => c.id === activeCamId);
      if (!match) {
        handleSelectCamera(filteredCameras[0], false);
      }
    } else {
      setActiveCamId(null);
    }
  }, [filteredCameras, activeCamId]);

  const pendingAdminActionRef = useRef<(() => void) | null>(null);

  async function loadReasons(root = settings.storage_root) {
    try {
      const data = await getJson<ReasonOptions>(reasonsPath(root));
      setReasonOptions({
        minor_stoppage: data.minor_stoppage || [],
        breakdown: data.breakdown || [],
      });
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function addReason(category: 'minor_stoppage' | 'breakdown', reason: string) {
    await postJson('/reasons', {
      storage_root: settings.storage_root,
      category,
      reason,
    });
    await loadReasons();
  }

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
      const isOnline = Boolean(
        recordingStatus.shared_camera?.has_frame ||
        (recordingStatus.shared_camera?.running && (recordingStatus.shared_camera?.frame_age_seconds ?? 999) < 6)
      );
      setCameraOnline(isOnline);
      setPlc(plcStatus);
      const plcMonitorActive = plcStatus.enabled !== false && plcStatus.running;
      if (plcMonitorActive && typeof plcStatus.capture_video === 'boolean') {
        const captureVideo = plcStatus.capture_video;
        setSettings((current) => (
          current.capture_video === captureVideo
            ? current
            : { ...current, capture_video: captureVideo }
        ));
      }
      if (plcMonitorActive && typeof plcStatus.capture_breakdown_video === 'boolean') {
        const captureBreakdownVideo = plcStatus.capture_breakdown_video;
        setSettings((current) => (
          current.capture_breakdown_video === captureBreakdownVideo
            ? current
            : { ...current, capture_breakdown_video: captureBreakdownVideo }
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
      const status = await getJson<RecordingStatus>('/recording/status');
      const isOnline = Boolean(
        status.shared_camera?.has_frame ||
        (status.shared_camera?.running && (status.shared_camera?.frame_age_seconds ?? 999) < 6)
      );
      setCameraOnline(isOnline);
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

  async function loadBackendSettings() {
    try {
      const backendSettings = await getJson<CameraSettings>('/settings');
      const mergedSettings = normalizeSettings({ ...settings, ...backendSettings });
      setSettings(mergedSettings);
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
    } catch {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  }

  useEffect(() => {
    if (!authenticated) return;
    loadBackendSettings();
    loadReasons();
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
    loadReasons(settings.storage_root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, settings.storage_root]);

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

  useEffect(() => {
    if (!settingsMessage) return;
    const timer = window.setTimeout(() => setSettingsMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [settingsMessage]);

  async function startSmartRecording() {
    setMessage('');
    try {
      if (!settings.plc_enabled) {
        const status = await postJson<RecordingStatus>('/recording/start', {
          ...buildCameraPayload(settings),
          event_type: 'self_capture',
          max_record_seconds: settings.max_record_seconds,
        });
        setRecording(status);
        return;
      }
      const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(settings));
      setPlc(status);
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  async function saveSettings(nextSettings = settings) {
    try {
      let mergedSettings = nextSettings;
      let monitorApplied = false;
      try {
        const savedSettings = await postJson<CameraSettings>('/settings', buildSettingsPayload(nextSettings));
        mergedSettings = normalizeSettings({ ...nextSettings, ...savedSettings });
      } catch {
        if (nextSettings.plc_enabled) {
          const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(nextSettings));
          setPlc(status);
        } else if (plc.enabled !== false && plc.running) {
          const status = await postJson<PlcStatus>('/plc-monitor/stop', { admin_password: 'Admin@123' });
          setPlc(status);
        }
        monitorApplied = true;
      }
      setSettings(mergedSettings);
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
      setSettingsMessageTone('good');
      setSettingsMessage(
        `Settings saved. Camera ${mergedSettings.ip}. Video: ${mergedSettings.capture_breakdown_video ? 'full event' : 'minor only'}.`,
      );
      if (!mergedSettings.plc_enabled && plc.enabled !== false && plc.running) {
        const status = await postJson<PlcStatus>('/plc-monitor/stop', { admin_password: 'Admin@123' });
        setPlc(status);
      } else if (!monitorApplied && mergedSettings.plc_enabled && plc.enabled !== false && plc.running) {
        const status = await postJson<PlcStatus>('/plc-monitor/start', buildPlcPayload(mergedSettings));
        setPlc(status);
      }
      verifyCamera();
    } catch (exc) {
      const error = friendlyError(exc);
      setSettingsMessageTone('bad');
      if (error) setSettingsMessage(error);
    }
  }

  function requestAdminAccess(action?: () => void) {
    pendingAdminActionRef.current = action || null;
    setAdminPromptPassword('');
    setAdminPromptError('');
    setAdminPromptShowPassword(false);
    setAdminPromptOpen(true);
  }

  async function submitAdminAccess(event: FormEvent) {
    event.preventDefault();
    try {
      const session = await authElevate(adminPromptPassword);
      localStorage.setItem('mer_role', 'admin');
      localStorage.setItem('mer_token', session.token);
      setAuthToken(session.token);
      setUserRole('admin');
      setSettingsMessageTone('good');
      setSettingsMessage('Admin access unlocked.');
      setAdminPromptOpen(false);
      setAdminPromptPassword('');
      const action = pendingAdminActionRef.current;
      pendingAdminActionRef.current = null;
      action?.();
      return;
    } catch {
      // Mock elevation removed for security. Only backend elevation is allowed.
    }
    setAdminPromptError('Incorrect ID or password.');
  }

  function cancelAdminAccess() {
    pendingAdminActionRef.current = null;
    setAdminPromptOpen(false);
    setAdminPromptPassword('');
    setAdminPromptError('');
    setAdminPromptShowPassword(false);
  }

  async function testPlcSettings() {
    setSettingsMessageTone('neutral');
    setSettingsMessage('Testing PLC...');
    setPlcTestResult(null);
    try {
      const result = await postJson<PlcTestResult>('/plc-test', buildPlcPayload(settings));
      setPlcTestResult(result);
      setSettingsMessageTone(result.ok ? 'good' : 'bad');
      setSettingsMessage(result.ok ? 'PLC test OK. Save settings to use this config.' : 'PLC test failed. Check IP, port, protocol, and address.');
    } catch (exc) {
      const error = friendlyError(exc);
      setSettingsMessageTone('bad');
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

  async function setRecordingMode(plcEnabled: boolean) {
    const nextSettings = { ...settings, plc_enabled: plcEnabled };
    setSettings(nextSettings);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    await saveSettings(nextSettings);
  }

  async function stopSmartRecording() {
    setMessage('');
    try {
      if (!settings.plc_enabled) {
        const status = await postJson<RecordingStatus>('/recording/stop', {});
        setRecording(status);
        return;
      }
      const status = await postJson<PlcStatus>('/plc-monitor/stop', { admin_password: 'Admin@123' });
      setPlc(status);
    } catch (exc) {
      const error = friendlyError(exc);
      if (error) setMessage(error);
    }
  }

  function handleLogin(session: AuthSession) {
    localStorage.setItem('mer_auth', 'true');
    localStorage.setItem('mer_role', session.role);
    localStorage.setItem('mer_token', session.token);
    setAuthToken(session.token);
    setUserRole(session.role);
    setAuthenticated(true);
  }

  function showAdminRequired(action?: () => void) {
    requestAdminAccess(action);
  }

  if (!authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  function logout() {
    localStorage.removeItem('mer_auth');
    localStorage.removeItem('mer_role');
    localStorage.removeItem('mer_token');
    setAuthToken('');
    setAuthenticated(false);
    setUserRole('user');
    setPage('live');
    setMessage('');
    setSettingsMessage('');
  }

  const currentActiveCam = filteredCameras.find(c => c.id === activeCamId) || filteredCameras[0] || null;
  const plcEndpoint = `${plc.plc_host || settings.plc_host || 'PLC'}:${plc.plc_port || settings.plc_port}`;

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
        onRecordingModeChange={setRecordingMode}
        onSaveSettings={() => saveSettings()}
        onTestPlc={testPlcSettings}
        onStartSmartRecording={startSmartRecording}
        onStopSmartRecording={stopSmartRecording}
        onAdminRequired={showAdminRequired}
        settingsMessage={settingsMessage}
        settingsMessageTone={settingsMessageTone}
        plcTestResult={plcTestResult}
        userRole={userRole}
        activeMachineName={currentActiveCam?.machine_name}
        onLogout={logout}
      />
      <main className="content">
        <TopBar
          page={page}
          recording={recording}
          settings={settings}
          online={cameraOnline}
          plc={plc}
          hierarchyTree={hierarchyTree}
          selectedPlantId={selectedPlantId}
          onChangePlant={handleChangePlant}
          availableDepts={availableDepts}
          selectedDeptId={selectedDeptId}
          onChangeDept={handleChangeDept}
          availableLines={availableLines}
          selectedLineId={selectedLineId}
          onChangeLine={handleChangeLine}
          cameras={filteredCameras}
          activeCamId={activeCamId}
          onSelectCamera={(cam) => handleSelectCamera(cam, true)}
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
        />
        {settingsMessage && (
          <div className={`app-toast ${settingsMessageTone}`}>
            {settingsMessage}
          </div>
        )}
        {page === 'hierarchy' ? (
          <SettingsHub
            settings={settings}
            setSettings={setSettings}
            recording={recording}
            plc={plc}
            stats={stats}
            onCaptureVideoChange={setCaptureVideo}
            onRecordingModeChange={setRecordingMode}
            onSaveSettings={() => saveSettings()}
            onTestPlc={testPlcSettings}
            onStartSmartRecording={startSmartRecording}
            onStopSmartRecording={stopSmartRecording}
            settingsMessage={settingsMessage}
            settingsMessageTone={settingsMessageTone}
            plcTestResult={plcTestResult}
            onBack={() => setPage('live')}
            activeMachineName={currentActiveCam?.machine_name}
          />
        ) : page === 'live' ? (
          <LivePage
            settings={settings}
            recording={recording}
            online={cameraOnline}
            plc={plc}
            stats={stats}
            cameras={filteredCameras}
            totalCamerasCount={flatCameras.length}
            activeCamId={activeCamId}
            onSelectCamera={(cam) => handleSelectCamera(cam, true)}
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
            onEditCamera={(cam) => setEditingCamera(cam)}
            onResetFilters={() => {
              setSelectedPlantId('all');
              setSelectedDeptId('all');
              setSelectedLineId('all');
            }}
            hierarchyTree={hierarchyTree}
            selectedPlantId={selectedPlantId}
            onChangePlant={handleChangePlant}
            availableDepts={availableDepts}
            selectedDeptId={selectedDeptId}
            onChangeDept={handleChangeDept}
            availableLines={availableLines}
            selectedLineId={selectedLineId}
            onChangeLine={handleChangeLine}
            onNavigateSaved={() => setPage('saved')}
          />
        ) : (
          <SavedPage
            page={page}
            settings={settings}
            refreshToken={refreshToken}
            stats={stats}
            plc={plc}
            userRole={userRole}
            onEditReason={() => undefined}
          />
        )}
        {editingCamera && (
          <CameraEditModal
            camera={editingCamera}
            onClose={() => setEditingCamera(null)}
            onSaved={() => {
              setEditingCamera(null);
              setSettingsMessage('Camera configuration saved and tested successfully!');
              setSettingsMessageTone('good');
              setTimeout(() => setSettingsMessage(''), 4500);
            }}
          />
        )}

      </main>
      {adminPromptOpen && (
        <div className="admin-modal-backdrop" role="presentation">
          <form className="admin-modal-card" onSubmit={submitAdminAccess}>
            <div className="admin-modal-icon"><Icon name="lock" /></div>
            <div>
              <span className="admin-modal-eyebrow">Protected Action</span>
              <h2>Admin Password Required</h2>
              <p>Enter admin password to unlock controls and continue this action.</p>
            </div>
            <label>
              Admin password
              <div className="admin-password-field">
                <input
                  autoFocus
                  type={adminPromptShowPassword ? 'text' : 'password'}
                  value={adminPromptPassword}
                  onChange={(event) => setAdminPromptPassword(event.target.value)}
                  placeholder="Admin password"
                />
                <button
                  type="button"
                  onClick={() => setAdminPromptShowPassword((value) => !value)}
                  aria-label={adminPromptShowPassword ? 'Hide password' : 'Show password'}
                  title={adminPromptShowPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={adminPromptShowPassword ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </label>
            {adminPromptError && <div className="admin-modal-error">{adminPromptError}</div>}
            <div className="admin-modal-actions">
              <button type="button" onClick={cancelAdminAccess}>Cancel</button>
              <button type="submit">Unlock</button>
            </div>
          </form>
        </div>
      )}
      <button className="sidebar-toggle" type="button" title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((value) => !value)}>
        <Icon name="chevron" />
      </button>
    </div>
  );
}
