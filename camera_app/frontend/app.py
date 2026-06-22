import base64
import json
import os
from datetime import datetime, time
from pathlib import Path
from urllib.parse import urlencode

import cv2
import numpy as np
import requests
import streamlit as st
import streamlit.components.v1 as components


DEFAULT_CAMERA_IP = os.getenv('CAMERA_IP', '192.168.119.205')
DEFAULT_CAMERA_USER = os.getenv('CAMERA_USER', 'admin')
DEFAULT_CAMERA_PASSWORD = os.getenv('CAMERA_PASSWORD', 'Admin@123')
DEFAULT_CAMERA_PORT = int(os.getenv('CAMERA_HTTP_PORT', os.getenv('HTTP_PORT', '80')))
DEFAULT_RTSP_PORT = int(os.getenv('CAMERA_RTSP_PORT', '554'))
DEFAULT_STORAGE_ROOT = Path(os.getenv('CPPLUS_STORAGE_ROOT', r'C:\CPPLUS_RECORDINGS'))
HELPER_URL = os.getenv('CPPLUS_HELPER_URL', 'http://127.0.0.1:8010').rstrip('/')

VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv', '.dav'}
BROWSER_PLAYABLE_EXTENSIONS = {'.mp4', '.webm', '.mov', '.m4v'}

st.set_page_config(page_title='CP Plus Camera Dashboard', layout='wide')

st.markdown(
    """
    <style>
      [data-testid="stToolbar"] { visibility: hidden; height: 0; }
      [data-testid="stDecoration"] { display: none; }
      .block-container { padding-top: 2.2rem; max-width: 1540px; }
      [data-testid="stSidebar"] { background: #25252f; }
      div.stButton > button {
        border-radius: 7px;
        min-height: 42px;
        font-weight: 650;
      }
      div[data-testid="stMetric"] {
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 8px;
        padding: 12px 14px;
      }
      .app-title {
        font-size: 2.25rem;
        font-weight: 750;
        margin: 0 0 .35rem 0;
      }
      .app-subtitle {
        color: #a8adb7;
        font-size: .95rem;
        margin-bottom: 1.1rem;
      }
      .status-pill {
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 8px;
        padding: 10px 12px;
        background: rgba(255,255,255,.035);
        min-height: 58px;
      }
      .status-label {
        color: #a8adb7;
        font-size: .78rem;
        margin-bottom: 2px;
      }
      .status-value {
        color: #ffffff;
        font-size: 1rem;
        font-weight: 700;
      }
      .live-frame {
        width: 100%;
        background: #05070a;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 8px;
        overflow: hidden;
        position: relative;
      }
      .live-frame:fullscreen {
        width: 100vw;
        height: 100vh;
        border-radius: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .live-frame img {
        display: block;
        width: 100%;
        height: auto;
      }
      .live-frame:fullscreen img {
        max-width: 100vw;
        max-height: 100vh;
        object-fit: contain;
      }
      .live-actions {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        gap: 8px;
        z-index: 10;
      }
      .live-actions button {
        background: rgba(0,0,0,.72);
        color: #fff;
        border: 1px solid rgba(255,255,255,.35);
        border-radius: 7px;
        padding: 8px 11px;
        font: 13px system-ui, sans-serif;
        cursor: pointer;
      }
      .muted-path {
        color: #9ca3af;
        font-size: .82rem;
        overflow-wrap: anywhere;
      }
      .video-card {
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 8px;
        background: rgba(255,255,255,.035);
        padding: 12px;
        min-height: 150px;
      }
      .video-title {
        font-weight: 750;
        margin-bottom: 8px;
        overflow-wrap: anywhere;
      }
      .video-meta {
        color: #b7bcc6;
        font-size: .85rem;
        line-height: 1.55;
      }
      .section-divider {
        height: 1px;
        background: rgba(255,255,255,.11);
        margin: 22px 0;
      }
    </style>
    """,
    unsafe_allow_html=True,
)

def helper_payload(ip: str, http_port: int, rtsp_port: int, username: str, password: str, channel_no: int, **extra):
    return {
        'ip': ip,
        'http_port': http_port,
        'rtsp_port': rtsp_port,
        'username': username,
        'password': password,
        'channel': channel_no,
        **extra,
    }


def helper_post(path: str, payload: dict) -> dict:
    response = requests.post(f'{HELPER_URL}{path}', json=payload, timeout=180)
    if not response.ok:
        try:
            detail = response.json().get('detail', response.text)
        except Exception:
            detail = response.text
        raise RuntimeError(detail)
    return response.json()


def helper_get(path: str) -> dict:
    response = requests.get(f'{HELPER_URL}{path}', timeout=30)
    if not response.ok:
        try:
            detail = response.json().get('detail', response.text)
        except Exception:
            detail = response.text
        raise RuntimeError(detail)
    return response.json()


def list_storage_videos(storage_root: Path) -> list[Path]:
    if not storage_root.exists():
        return []
    return sorted(
        (
            path
            for path in storage_root.rglob('*')
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def file_size_text(size: int) -> str:
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f'{value:.1f} {unit}' if unit != 'B' else f'{int(value)} B'
        value /= 1024
    return f'{size} B'


def load_video_metadata(video_path: Path) -> dict:
    metadata_path = video_path.with_suffix('.json')
    if not metadata_path.exists():
        return {}
    try:
        return json.loads(metadata_path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def display_time(value: str | None, fallback_timestamp: float | None = None) -> str:
    if value:
        try:
            return datetime.fromisoformat(value).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError:
            return value
    if fallback_timestamp:
        return datetime.fromtimestamp(fallback_timestamp).strftime('%Y-%m-%d %H:%M:%S')
    return '-'


def duration_text(seconds: float | int | None) -> str:
    if seconds is None:
        return '-'
    total = int(float(seconds))
    minutes, sec = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f'{hours}h {minutes}m {sec}s'
    if minutes:
        return f'{minutes}m {sec}s'
    return f'{sec}s'


def show_connection_error(exc: Exception, target: str):
    message = str(exc)
    st.error(target)
    st.code(message)


def render_stored_videos(
    storage_root: Path,
    start_at: datetime,
    end_at: datetime,
    force_refresh: bool = False,
    key_prefix: str = 'stored',
):
    st.caption(f'Source: {storage_root}')
    filter_col, scan_col = st.columns([2, 1])
    with filter_col:
        only_selected_range = st.checkbox(
            'Filter by selected date/time',
            value=False,
            key=f'{key_prefix}_range_filter',
        )
    with scan_col:
        scan_clicked = st.button('Refresh List', use_container_width=True, key=f'{key_prefix}_scan')

    if force_refresh or scan_clicked or not st.session_state.storage_videos:
        st.session_state.storage_videos = list_storage_videos(storage_root)

    stored_files = st.session_state.storage_videos
    if only_selected_range:
        stored_files = [
            path
            for path in stored_files
            if start_at <= datetime.fromtimestamp(path.stat().st_mtime) <= end_at
        ]

    if not storage_root.exists():
        st.warning('Saved video DB folder abhi exist nahi karta. Correct path set karo.')
        return
    if not stored_files:
        st.info('Abhi saved video folder me video nahi hai. Recording save hone ke baad Refresh List dabao.')
        return

    st.markdown('<div class="section-divider"></div>', unsafe_allow_html=True)
    st.subheader('Recording Cards')

    columns_per_row = 3
    for row_start in range(0, len(stored_files), columns_per_row):
        row = st.columns(columns_per_row)
        for offset, video_path in enumerate(stored_files[row_start:row_start + columns_per_row]):
            index = row_start + offset + 1
            stat = video_path.stat()
            metadata = load_video_metadata(video_path)
            start_text = display_time(metadata.get('started_at'), stat.st_mtime)
            end_text = display_time(metadata.get('ended_at'))
            duration = duration_text(metadata.get('duration_seconds'))
            size = file_size_text(stat.st_size)
            with row[offset]:
                with st.container(border=True):
                    badge = 'Latest' if index == 1 else f'#{index}'
                    st.markdown(
                        f"""
                        <div class="video-card">
                          <div class="video-title">{badge}: {video_path.name}</div>
                          <div class="video-meta">
                            Start: {start_text}<br>
                            End: {end_text}<br>
                            Duration: {duration}<br>
                            Size: {size}
                          </div>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )
                    if video_path.suffix.lower() in BROWSER_PLAYABLE_EXTENSIONS:
                        st.video(str(video_path))
                    else:
                        st.info('DAV/unsupported video ko browser direct play nahi karega. Download karke VLC/CP Plus player me dekho.')
                    if st.button('Prepare Download', key=f'{key_prefix}_prepare_{index}_{video_path.name}', use_container_width=True):
                        st.download_button(
                            'Download Video',
                            video_path.read_bytes(),
                            file_name=video_path.name,
                            key=f'{key_prefix}_download_{index}_{video_path.name}',
                            use_container_width=True,
                        )


try:
    recording_status = helper_get('/recording/status')
except Exception:
    recording_status = {'running': False, 'error': 'Recording helper unavailable'}

if 'page' not in st.session_state:
    st.session_state.page = 'Live Camera'

with st.sidebar:
    st.header('CP Plus')
    st.caption('Navigation')
    if st.button(
        'Live Camera',
        use_container_width=True,
        type='primary' if st.session_state.page == 'Live Camera' else 'secondary',
    ):
        st.session_state.page = 'Live Camera'
    if st.button(
        'Saved Videos',
        use_container_width=True,
        type='primary' if st.session_state.page == 'Saved Videos' else 'secondary',
    ):
        st.session_state.page = 'Saved Videos'
    st.divider()

    st.subheader('Live Stream')
    continuous_live = st.checkbox('Live stream on', value=True)
    refresh_live_clicked = st.button('Reload Live', use_container_width=True)
    st.divider()

    st.subheader('Recording')
    if recording_status.get('running'):
        st.success('Recording is running')
        st.caption(f"Started: {display_time(recording_status.get('started_at'))}")
        st.caption(f"Frames: {recording_status.get('frames', 0)}")
    else:
        st.caption('Recording is stopped')

    start_recording_clicked = st.button(
        'Start Recording',
        use_container_width=True,
        type='primary',
        disabled=bool(recording_status.get('running')),
    )
    stop_recording_clicked = st.button(
        'Stop and Save',
        use_container_width=True,
        disabled=not bool(recording_status.get('running')),
    )
    st.divider()

    st.subheader('Camera Details')
    camera_ip = st.text_input('Camera IP', DEFAULT_CAMERA_IP)
    channel = st.number_input('Channel', min_value=1, max_value=128, value=1)

    with st.expander('Settings'):
        refresh_storage_clicked = st.button('Refresh Saved Videos', use_container_width=True)
        camera_port = st.number_input('HTTP Port', min_value=1, max_value=65535, value=DEFAULT_CAMERA_PORT)
        rtsp_port = st.number_input('RTSP Port', min_value=1, max_value=65535, value=DEFAULT_RTSP_PORT)
        camera_user = st.text_input('Username', DEFAULT_CAMERA_USER)
        camera_password = st.text_input('Password', DEFAULT_CAMERA_PASSWORD, type='password')
        storage_folder_text = st.text_input('Saved video folder', str(DEFAULT_STORAGE_ROOT))

        today = datetime.now().date()
        start_date = st.date_input('Start date', today)
        start_time = st.time_input('Start time', time(0, 0, 0))
        end_date = st.date_input('End date', today)
        end_time = st.time_input('End time', time(23, 59, 59))

page = st.session_state.page

start_at = datetime.combine(start_date, start_time)
end_at = datetime.combine(end_date, end_time)
storage_root = Path(storage_folder_text).expanduser()

if end_at <= start_at:
    st.error('End time start time se baad ka hona chahiye.')
    st.stop()

if 'storage_videos' not in st.session_state:
    st.session_state.storage_videos = []
if 'live_frame' not in st.session_state:
    st.session_state.live_frame = None
if 'live_source' not in st.session_state:
    st.session_state.live_source = None

if start_recording_clicked:
    try:
        recording_status = helper_post(
            '/recording/start',
            helper_payload(
                camera_ip.strip(),
                int(camera_port),
                int(rtsp_port),
                camera_user,
                camera_password,
                int(channel),
                storage_root=str(storage_root),
            ),
        )
        st.sidebar.success('Recording started.')
    except Exception as exc:
        st.sidebar.error(f'Recording start failed: {exc}')

if stop_recording_clicked:
    try:
        recording_status = helper_post('/recording/stop', {})
        st.session_state.storage_videos = list_storage_videos(storage_root)
        st.sidebar.success('Recording saved.')
    except Exception as exc:
        st.sidebar.error(f'Recording stop failed: {exc}')

if refresh_live_clicked or (not continuous_live and st.session_state.live_frame is None):
    try:
        with st.spinner('Live camera loading...'):
            result = helper_post(
                '/live-frame',
                helper_payload(
                    camera_ip.strip(),
                    int(camera_port),
                    int(rtsp_port),
                    camera_user,
                    camera_password,
                    int(channel),
                ),
            )
            frame_bytes = base64.b64decode(result['frame'])
            frame_array = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
            st.session_state.live_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            st.session_state.live_source = result.get('url')
        live_error = None
    except Exception as exc:
        st.session_state.live_frame = None
        st.session_state.live_source = None
        live_error = exc
else:
    live_error = None

if refresh_storage_clicked or not st.session_state.storage_videos:
    st.session_state.storage_videos = list_storage_videos(storage_root)

page_subtitle = (
    'Watch the live camera and control PC recording.'
    if page == 'Live Camera'
    else 'Review, play, and download saved camera recordings.'
)
st.markdown(f'<div class="app-title">{page}</div>', unsafe_allow_html=True)
st.markdown(f'<div class="app-subtitle">{page_subtitle}</div>', unsafe_allow_html=True)

if page == 'Live Camera':
    status_live = 'Streaming' if continuous_live else 'Snapshot'
    status_recording = 'Recording' if recording_status.get('running') else 'Idle'
    status_saved = len(st.session_state.storage_videos)
    status_cols = st.columns(4)
    status_items = [
        ('Camera', f'{camera_ip} / CH {int(channel)}'),
        ('Live', status_live),
        ('Recording', status_recording),
        ('Saved Videos', str(status_saved)),
    ]
    for col, (label, value) in zip(status_cols, status_items):
        with col:
            st.markdown(
                f"""
                <div class="status-pill">
                  <div class="status-label">{label}</div>
                  <div class="status-value">{value}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

    st.write('')

if page == 'Live Camera':
    st.subheader('Live Camera')
    if continuous_live:
        stream_query = urlencode(
            {
                'ip': camera_ip.strip(),
                'rtsp_port': int(rtsp_port),
                'username': camera_user,
                'password': camera_password,
                'channel': int(channel),
            }
        )
        stream_url = f'{HELPER_URL}/mjpeg?{stream_query}'
        components.html(
            f"""
            <div id="live-frame" class="live-frame">
              <div class="live-actions">
                <button type="button" onclick="document.getElementById('live-frame').requestFullscreen()">Full screen</button>
                <button type="button" onclick="document.fullscreenElement && document.exitFullscreen()">Minimize</button>
              </div>
              <img src="{stream_url}" style="display:block; width:100%; height:auto;" />
            </div>
            """,
            height=720,
        )
        if recording_status.get('running'):
            st.success(f"Live running and recording. Frames saved: {recording_status.get('frames', 0)}")
        else:
            st.success('Continuous live running')
        if recording_status.get('error'):
            st.error(f"Recording error: {recording_status['error']}")
    elif st.session_state.live_frame is not None:
        st.image(st.session_state.live_frame, channels='RGB', width='stretch')
        if recording_status.get('running'):
            st.success(f"Live running and recording to PC. Frames saved: {recording_status.get('frames', 0)}")
        else:
            st.success('Live running')
        if recording_status.get('error'):
            st.error(f"Recording error: {recording_status['error']}")
    elif live_error:
        show_connection_error(live_error, 'Live camera connect nahi hua')
    else:
        st.info('Reload Live dabao.')

else:
    st.subheader('Saved Videos')
    stored_files = st.session_state.storage_videos
    st.markdown(f'<div class="muted-path">Source: {storage_root}</div>', unsafe_allow_html=True)
    if recording_status.get('running'):
        st.info('Recording active. Stop and Save ke baad latest file yahan dikhegi.')

    if not storage_root.exists():
        st.warning('Saved video folder nahi mila.')
    elif not stored_files:
        st.info('Abhi saved video folder me video nahi hai.')
    else:
        latest_file = stored_files[0]
        latest_stat = latest_file.stat()
        metadata = load_video_metadata(latest_file)
        with st.container(border=True):
            st.write('**Latest recording**')
            st.caption(latest_file.name)
            meta_col_1, meta_col_2, meta_col_3 = st.columns(3)
            meta_col_1.write(f"**Start:** {display_time(metadata.get('started_at'), latest_stat.st_mtime)}")
            meta_col_2.write(f"**Duration:** {duration_text(metadata.get('duration_seconds'))}")
            meta_col_3.write(f'**Size:** {file_size_text(latest_stat.st_size)}')
        if st.button('Download Latest', use_container_width=True):
            st.download_button('Save File', latest_file.read_bytes(), file_name=latest_file.name, use_container_width=True)

    st.divider()
    st.subheader('Video Library')
    render_stored_videos(
        storage_root,
        start_at,
        end_at,
        force_refresh=refresh_storage_clicked,
        key_prefix='stored_full',
    )
