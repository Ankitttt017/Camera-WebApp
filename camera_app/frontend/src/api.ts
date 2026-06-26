export const API_BASE = import.meta.env.VITE_HELPER_URL || 'http://127.0.0.1:8010';

export type CameraSettings = {
  ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password: string;
  channel: number;
  storage_root: string;
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
  running: boolean;
  last_read_at?: string | null;
  last_error?: string | null;
  last_action?: string | null;
  gate_open?: boolean;
  gate_close?: boolean;
  current_event_type?: string | null;
  current_event_started_at?: string | null;
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

export function recordingFileUrl(storageRoot: string, filePath: string, download = false) {
  return queryUrl('/recording-file', {
    storage_root: storageRoot,
    file_path: filePath,
    download,
  });
}
