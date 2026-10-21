const DEFAULT_API_BASE = `${window.location.protocol}//${window.location.hostname}:8010`;

export const API_BASE = import.meta.env.VITE_HELPER_URL || DEFAULT_API_BASE;
let AUTH_TOKEN = window.localStorage.getItem('mer_token') || '';

export function setAuthToken(token: string) {
  AUTH_TOKEN = token;
}

export type CameraSettings = {
  ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password: string;
  channel: number;
  rtsp_path?: string | null;
  storage_root: string;
  public_helper_url: string;
  capture_video: boolean;
  capture_breakdown_video: boolean;
  plc_enabled: boolean;
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
  reason_category?: string | null;
  reason?: string | null;
  reason_note?: string | null;
  reason_submitted_by?: string | null;
  reason_submitted_at?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  transcript_error?: string | null;
  transcribed_at?: string | null;
  updated_at?: string | null;
  shared_camera?: {
    running?: boolean;
    has_frame?: boolean;
    frame_age_seconds?: number | null;
    width?: number | null;
    height?: number | null;
    fps?: number | null;
    last_error?: string | null;
  };
};

export type AuthSession = {
  username: string;
  role: 'superadmin' | 'admin' | 'user';
  token: string;
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
  storage_root?: string | null;
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
  reason_category?: string | null;
  reason?: string | null;
  reason_note?: string | null;
  reason_submitted_by?: string | null;
  reason_submitted_at?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  transcript_error?: string | null;
  transcribed_at?: string | null;
  updated_at?: string | null;
  manual_transcript?: string | null;
};

export type ReasonOption = {
  id: number;
  category: string;
  reason: string;
  active?: number;
};

export type ReasonOptions = Record<string, ReasonOption[]>;

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
    rtsp_path: settings.rtsp_path || undefined,
    storage_root: settings.storage_root,
    capture_video: settings.capture_video,
    capture_breakdown_video: settings.capture_breakdown_video,
    plc_enabled: settings.plc_enabled,
  };
}

export function buildPlcPayload(settings: CameraSettings) {
  const isXDevice = (settings.plc_device.trim() || 'M').toUpperCase() === 'X';
  return {
    ...buildCameraPayload(settings),
    plc_host: settings.plc_host.trim(),
    plc_port: Number(settings.plc_port),
    plc_device: settings.plc_device.trim() || 'M',
    gate_open_addresses: [settings.plc_address.trim() || '810'],
    gate_close_addresses: [settings.plc_address.trim() || '810'],
    gate_open_when: isXDevice ? false : true,
    gate_close_when: isXDevice ? true : false,
    poll_seconds: 1,
    max_record_seconds: Math.max(1, Number(settings.max_record_seconds || 30)),
    admin_password: 'Pass-RicoAuto123',
  };
}

export function buildSettingsPayload(settings: CameraSettings) {
  return {
    ...buildCameraPayload(settings),
    public_helper_url: settings.public_helper_url,
    plc_host: settings.plc_host.trim(),
    plc_port: Number(settings.plc_port),
    plc_device: settings.plc_device.trim() || 'M',
    plc_address: settings.plc_address.trim() || '810',
    max_record_seconds: Math.max(1, Number(settings.max_record_seconds || 300)),
    admin_password: 'Pass-RicoAuto123',
  };
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(AUTH_TOKEN ? { 'X-Auth-Token': AUTH_TOKEN } : {}),
    },
  });
  return parseResponse<T>(response);
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { 'X-Auth-Token': AUTH_TOKEN } : {}),
    },
    body: JSON.stringify(payload),
  });
  return parseResponse<T>(response);
}

export async function authLogin(username: string, password: string): Promise<AuthSession> {
  return postJson<AuthSession>('/auth/login', { username, password });
}

export async function authElevate(password: string): Promise<AuthSession> {
  return postJson<AuthSession>('/auth/elevate', { username: 'Ricoadmin', password });
}

export function queryUrl(path: string, params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || String(value).trim().toLowerCase() === 'null') continue;
    query.set(key, String(value));
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
    rtsp_path: settings.rtsp_path || undefined,
  });
}

export function liveVideoUrl(settings: CameraSettings, nonce: number) {
  return queryUrl('/live.mp4', {
    ip: settings.ip.trim(),
    rtsp_port: settings.rtsp_port,
    username: settings.username,
    password: settings.password,
    channel: settings.channel,
    rtsp_path: settings.rtsp_path || undefined,
    t: nonce,
  });
}

export function liveJpegUrl(settings: CameraSettings, nonce: number) {
  return queryUrl('/live.jpg', {
    ip: settings.ip.trim(),
    rtsp_port: settings.rtsp_port,
    username: settings.username,
    password: settings.password,
    channel: settings.channel,
    rtsp_path: settings.rtsp_path || undefined,
    t: nonce,
  });
}

export function audioUrl(settings: CameraSettings) {
  return queryUrl('/audio.mp3', {
    ip: settings.ip.trim(),
    rtsp_port: settings.rtsp_port,
    username: settings.username,
    password: settings.password,
    channel: settings.channel,
    rtsp_path: settings.rtsp_path || undefined,
  });
}

export function recordingFileUrl(storageRoot: string, filePath: string, download = false) {
  return queryUrl('/recording-file', {
    storage_root: storageRoot,
    file_path: filePath,
    download,
  });
}

export function reasonsPath(storageRoot: string) {
  return `/reasons?${new URLSearchParams({ storage_root: storageRoot }).toString()}`;
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

/* ─────────────────────────────────────────────────────────────
   Plant ➔ Department ➔ Line ➔ Machine ➔ Camera Hierarchy APIs
   ───────────────────────────────────────────────────────────── */

export type HierarchyCamera = {
  id: number;
  machine_id: number;
  name: string;
  camera_ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password?: string;
  channel: number;
  rtsp_path: string;
  sub_rtsp_path?: string;
  is_active: boolean;
};

export type HierarchyMachine = {
  id: number;
  line_id: number;
  code: string;
  name: string;
  plc_enabled: boolean;
  plc_host?: string;
  plc_port: number;
  plc_device: string;
  plc_address: string;
  is_active: boolean;
  cameras: HierarchyCamera[];
};

export type HierarchyLine = {
  id: number;
  department_id: number;
  code: string;
  name: string;
  is_active: boolean;
  machines: HierarchyMachine[];
};

export type HierarchyDepartment = {
  id: number;
  plant_id: number;
  code: string;
  name: string;
  is_active: boolean;
  lines: HierarchyLine[];
};

export type HierarchyPlant = {
  id: number;
  code: string;
  name: string;
  location?: string;
  is_active: boolean;
  departments: HierarchyDepartment[];
};

export type FlatCamera = {
  id: number;
  name: string;
  camera_ip: string;
  http_port: number;
  rtsp_port: number;
  username: string;
  password?: string;
  channel: number;
  rtsp_path: string;
  sub_rtsp_path?: string;
  is_active: boolean;
  machine_id: number;
  machine_name: string;
  machine_code: string;
  plc_enabled: boolean;
  plc_host?: string;
  plc_port: number;
  plc_device: string;
  plc_address: string;
  line_id: number;
  line_name: string;
  line_code: string;
  department_id: number;
  department_name: string;
  department_code: string;
  plant_id: number;
  plant_name: string;
  plant_code: string;
};

export async function fetchHierarchy(): Promise<HierarchyPlant[]> {
  return getJson<HierarchyPlant[]>('/api/hierarchy');
}

export async function fetchFlatCameras(params?: {
  plant_id?: number;
  department_id?: number;
  line_id?: number;
  machine_id?: number;
}): Promise<FlatCamera[]> {
  const query = new URLSearchParams();
  if (params?.plant_id) query.set('plant_id', String(params.plant_id));
  if (params?.department_id) query.set('department_id', String(params.department_id));
  if (params?.line_id) query.set('line_id', String(params.line_id));
  if (params?.machine_id) query.set('machine_id', String(params.machine_id));
  const qs = query.toString();
  return getJson<FlatCamera[]>(`/api/hierarchy/cameras${qs ? `?${qs}` : ''}`);
}

export async function createPlant(data: { code: string; name: string; location?: string; is_active?: boolean }) {
  return postJson('/api/hierarchy/plants', data);
}

export async function updatePlant(id: number, data: Partial<{ code: string; name: string; location?: string; is_active?: boolean }>) {
  const res = await fetch(`${API_BASE}/api/hierarchy/plants/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {}) },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deletePlant(id: number) {
  const res = await fetch(`${API_BASE}/api/hierarchy/plants/${id}`, {
    method: 'DELETE',
    headers: AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {},
  });
  return res.json();
}

export async function createDepartment(data: { plant_id: number; code: string; name: string; is_active?: boolean }) {
  return postJson('/api/hierarchy/departments', data);
}

export async function updateDepartment(id: number, data: Partial<{ plant_id?: number; code?: string; name?: string; is_active?: boolean }>) {
  const res = await fetch(`${API_BASE}/api/hierarchy/departments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {}) },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteDepartment(id: number) {
  const res = await fetch(`${API_BASE}/api/hierarchy/departments/${id}`, {
    method: 'DELETE',
    headers: AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {},
  });
  return res.json();
}

export async function createLine(data: { department_id: number; code: string; name: string; is_active?: boolean }) {
  return postJson('/api/hierarchy/lines', data);
}

export async function updateLine(id: number, data: Partial<{ department_id?: number; code?: string; name?: string; is_active?: boolean }>) {
  const res = await fetch(`${API_BASE}/api/hierarchy/lines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {}) },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteLine(id: number) {
  const res = await fetch(`${API_BASE}/api/hierarchy/lines/${id}`, {
    method: 'DELETE',
    headers: AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {},
  });
  return res.json();
}

export async function createMachine(data: {
  line_id: number;
  code: string;
  name: string;
  plc_enabled?: boolean;
  plc_host?: string;
  plc_port?: number;
  plc_device?: string;
  plc_address?: string;
  is_active?: boolean;
}) {
  return postJson('/api/hierarchy/machines', data);
}

export async function updateMachine(id: number, data: Partial<{
  line_id?: number;
  code?: string;
  name?: string;
  plc_enabled?: boolean;
  plc_host?: string;
  plc_port?: number;
  plc_device?: string;
  plc_address?: string;
  is_active?: boolean;
}>) {
  const res = await fetch(`${API_BASE}/api/hierarchy/machines/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {}) },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteMachine(id: number) {
  const res = await fetch(`${API_BASE}/api/hierarchy/machines/${id}`, {
    method: 'DELETE',
    headers: AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {},
  });
  return res.json();
}

export async function createCamera(data: {
  machine_id: number;
  name: string;
  camera_ip: string;
  http_port?: number;
  rtsp_port?: number;
  username?: string;
  password?: string;
  channel?: number;
  rtsp_path?: string;
  sub_rtsp_path?: string;
  is_active?: boolean;
}) {
  return postJson('/api/hierarchy/cameras', data);
}

export async function updateCamera(id: number, data: Partial<{
  machine_id?: number;
  name?: string;
  camera_ip?: string;
  http_port?: number;
  rtsp_port?: number;
  username?: string;
  password?: string;
  channel?: number;
  rtsp_path?: string;
  sub_rtsp_path?: string;
  is_active?: boolean;
}>) {
  const res = await fetch(`${API_BASE}/api/hierarchy/cameras/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {}) },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteCamera(id: number) {
  const res = await fetch(`${API_BASE}/api/hierarchy/cameras/${id}`, {
    method: 'DELETE',
    headers: AUTH_TOKEN ? { 'x-auth-token': AUTH_TOKEN } : {},
  });
  return res.json();
}

export async function testCameraConnection(data: {
  camera_ip: string;
  http_port?: number;
  rtsp_port?: number;
  username?: string;
  password?: string;
  channel?: number;
  rtsp_path?: string;
}) {
  return postJson<{
    ip: string;
    ping: boolean;
    http_open: boolean;
    rtsp_open: boolean;
    rtsp_stream_ok: boolean;
    message: string;
  }>('/api/hierarchy/test-camera', data);
}

export async function testPlcConnection(data: {
  plc_host: string;
  plc_port?: number;
  plc_device?: string;
  plc_address?: string;
}) {
  return postJson<{ ok: boolean; message: string }>('/api/hierarchy/test-plc', data);
}

export function hierarchyCameraSnapshotUrl(cameraId: number) {
  return `${API_BASE}/api/hierarchy/cameras/${cameraId}/live.jpg?t=${Date.now()}`;
}

export function hierarchyCameraMjpegUrl(cameraId: number) {
  return `${API_BASE}/api/hierarchy/cameras/${cameraId}/mjpeg`;
}

export function hierarchyCameraAudioUrl(cameraId: number): string {
  return `${API_BASE}/api/hierarchy/cameras/${cameraId}/audio.mp3?t=${Date.now()}`;
}

