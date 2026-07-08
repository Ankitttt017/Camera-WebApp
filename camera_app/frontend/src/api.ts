export const API_BASE = import.meta.env.VITE_HELPER_URL || 'http://192.168.100.137:8010';

export type CameraSettings = {
  ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password: string;
  channel: number;
  storage_root: string;
  public_helper_url: string;
  capture_video: boolean;
  capture_breakdown_video: boolean;
  plc_host: string;
  plc_port: number;
  plc_device: string;
  plc_address: string;
  max_record_seconds: number;
};

export type RecordingStatus = {
  running: boolean;
  path?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  error?: string | null;
  frames?: number;
  audio?: string | null;
  event_type?: string | null;
  event_started_at?: string | null;
  event_ended_at?: string | null;
  event_duration_seconds?: number | null;
  updated_at?: string | null;
};

export type PlcStatus = {
  enabled?: boolean;
  capture_video?: boolean;
  capture_breakdown_video?: boolean;
  running: boolean;
  plc_host?: string | null;
  plc_port?: number | null;
  last_read_at?: string | null;
  last_error?: string | null;
  last_action?: string | null;
  gate_open?: boolean;
  gate_close?: boolean;
  machine_state?: 'running' | 'minor_stoppage' | 'breakdown' | string | null;
  machine_state_started_at?: string | null;
  machine_state_duration_seconds?: number | null;
  current_event_type?: string | null;
  current_event_started_at?: string | null;
  current_event_duration_seconds?: number | null;
  last_gate_opened_at?: string | null;
  last_gate_closed_at?: string | null;
};

export type PlcTestResult = {
  reachable: boolean;
  ok: boolean;
  host: string;
  port: number;
  device: string;
  open_addresses: Array<string | number>;
  close_addresses: Array<string | number>;
  open_values: Record<string, boolean>;
  close_values: Record<string, boolean>;
  errors: string[];
  message: string;
};

export type RecordingRecord = {
  file_path: string;
  file_name: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  file_size?: number | null;
  status?: string | null;
  error?: string | null;
  recording_engine?: string | null;
  audio?: string | null;
  event_type?: string | null;
  event_started_at?: string | null;
  event_ended_at?: string | null;
  event_duration_seconds?: number | null;
  updated_at?: string | null;
};

export type RecordingList = {
  total: number;
  page: number;
  page_size: number;
  records: RecordingRecord[];
};

export type RecordingStats = {
  today: {
    total_events: number;
    minor_stoppage_count: number;
    breakdown_count: number;
    recorded_duration_seconds: number;
    breakdown_duration_seconds: number;
    storage_used: number;
  };
  storage: {
    today: number;
    week: number;
    month: number;
    total: number;
    video_count: number;
    average_file_size: number;
  };
  breakdown: {
    average_duration_seconds: number;
    longest_duration_seconds: number;
  };
  latest_event?: RecordingRecord | null;
  trend: Array<{ day: string; video_count: number; storage_used: number }>;
  top_heavy_videos: Array<{ file_name: string; file_path: string; file_size: number; started_at?: string | null; event_type?: string | null }>;
  machines: string[];
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function buildCameraPayload(settings: CameraSettings) {
  return {
    ip: settings.ip.trim(),
    http_port: Number(settings.http_port),
    rtsp_port: Number(settings.rtsp_port),
    username: settings.username,
    password: settings.password,
    channel: Number(settings.channel),
    storage_root: settings.storage_root,
    capture_video: settings.capture_video,
    capture_breakdown_video: settings.capture_breakdown_video,
  };
}

export function buildPlcPayload(settings: CameraSettings) {
  return {
    ...buildCameraPayload(settings),
    plc_host: settings.plc_host.trim(),
    plc_port: Number(settings.plc_port),
    plc_device: settings.plc_device.trim() || 'X',
    gate_open_addresses: [settings.plc_address.trim() || '4A'],
    gate_close_addresses: [settings.plc_address.trim() || '4A'],
    gate_open_when: false,
    gate_close_when: true,
    poll_seconds: 1,
    max_record_seconds: Math.max(1, Number(settings.max_record_seconds || 30)),
  };
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  return parseResponse<T>(response);
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<T>(response);
}

export function queryUrl(path: string, params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return `${API_BASE}${path}?${query.toString()}`;
}

export function mjpegUrl(settings: CameraSettings) {
  return queryUrl('/mjpeg', {
    ip: settings.ip.trim(),
    rtsp_port: settings.rtsp_port,
    username: settings.username,
    password: settings.password,
    channel: settings.channel,
  });
}

export function audioUrl(settings: CameraSettings) {
  return queryUrl('/audio.mp3', {
    ip: settings.ip.trim(),
    rtsp_port: settings.rtsp_port,
    username: settings.username,
    password: settings.password,
    channel: settings.channel,
  });
}

export function recordingFileUrl(storageRoot: string, filePath: string, download = false) {
  return queryUrl('/recording-file', {
    storage_root: storageRoot,
    file_path: filePath,
    download,
  });
}

export function recordingExportUrl(params: {
  storage_root: string;
  start_at?: string;
  end_at?: string;
  event_type?: string;
  shift?: string;
  public_helper_url?: string;
}) {
  return queryUrl('/recording-index/export.xlsx', params);
}
