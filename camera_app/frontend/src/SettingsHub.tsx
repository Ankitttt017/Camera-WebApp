import { useEffect, useState } from 'react';
import { CameraSettings, RecordingStats } from './api';
import { HierarchyManager } from './HierarchyManager';

type Tab = 'cameras' | 'rules' | 'storage';

interface SettingsHubProps {
  settings: CameraSettings;
  stats: RecordingStats;
  /** Saves only the given plant-wide fields; camera and PLC details live with each camera. */
  onSaveRules: (patch: Partial<CameraSettings>) => Promise<boolean>;
  settingsMessage: string;
  settingsMessageTone: 'good' | 'bad' | 'neutral';
  onBack?: () => void;
}

const TABS: { id: Tab; title: string; hint: string }[] = [
  { id: 'cameras', title: 'Cameras', hint: 'Add cameras, choose Manual or Auto' },
  { id: 'rules', title: 'Recording rules', hint: 'What gets saved, for all cameras' },
  { id: 'storage', title: 'Storage', hint: 'Where videos are kept' },
];

export function SettingsHub({ settings, stats, onSaveRules, settingsMessage, settingsMessageTone, onBack }: SettingsHubProps) {
  const [tab, setTab] = useState<Tab>('cameras');

  return (
    <div className="st-page">
      <header className="st-head">
        <div className="st-head-title">
          {onBack && (
            <button type="button" className="er-btn er-btn-secondary" onClick={onBack}>← Back to Live</button>
          )}
          <div>
            <h1>Settings</h1>
            <p>Each camera works on its own. Changes here are saved for everyone using this system.</p>
          </div>
        </div>
        <nav className="st-tabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'st-tab is-active' : 'st-tab'} onClick={() => setTab(t.id)}>
              <strong>{t.title}</strong>
              <small>{t.hint}</small>
            </button>
          ))}
        </nav>
      </header>

      {settingsMessage && tab !== 'cameras' && (
        <div className={`st-toast st-toast-${settingsMessageTone}`} role="status">{settingsMessage}</div>
      )}

      <div className="st-body">
        {tab === 'cameras' && <HierarchyManager />}
        {tab === 'rules' && <RulesTab settings={settings} onSave={onSaveRules} />}
        {tab === 'storage' && <StorageTab settings={settings} stats={stats} onSave={onSaveRules} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- rules */

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={checked ? 'st-switch is-on' : 'st-switch'} onClick={() => onChange(!checked)}>
      <span className="st-switch-knob" />
      <span className="st-switch-text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

function RulesTab({ settings, onSave }: { settings: CameraSettings; onSave: (patch: Partial<CameraSettings>) => Promise<boolean> }) {
  const [captureVideo, setCaptureVideo] = useState(settings.capture_video);
  const [fullBreakdown, setFullBreakdown] = useState(settings.capture_breakdown_video);
  const [limit, setLimit] = useState(String(settings.max_record_seconds || 120));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCaptureVideo(settings.capture_video);
    setFullBreakdown(settings.capture_breakdown_video);
    setLimit(String(settings.max_record_seconds || 120));
  }, [settings.capture_video, settings.capture_breakdown_video, settings.max_record_seconds]);

  const limitNumber = Math.round(Number(limit));
  const limitValid = Number.isFinite(limitNumber) && limitNumber >= 10 && limitNumber <= 3600;
  const dirty = captureVideo !== settings.capture_video
    || fullBreakdown !== settings.capture_breakdown_video
    || limitNumber !== Number(settings.max_record_seconds);

  async function save() {
    if (!limitValid) return;
    setSaving(true);
    await onSave({ capture_video: captureVideo, capture_breakdown_video: fullBreakdown, max_record_seconds: limitNumber });
    setSaving(false);
  }

  return (
    <div className="st-section">
      <p className="st-intro">These rules apply to every camera that is on <strong>Auto</strong>. Manual recordings always save video.</p>

      <div className="st-card st-row">
        <div>
          <h3>Save video when a machine stops</h3>
          <p>On: a video is saved for every stoppage. Off: only the stop time is saved in the Event Report, without video.</p>
        </div>
        <Toggle checked={captureVideo} onChange={setCaptureVideo} label="Save video when a machine stops" />
      </div>

      <div className={captureVideo ? 'st-card st-row' : 'st-card st-row is-disabled'}>
        <div>
          <h3>Record the whole breakdown</h3>
          <p>On: the video runs until the machine starts again (up to 60 minutes). Off: the video stops at the limit below; the breakdown time is still counted.</p>
        </div>
        <Toggle checked={fullBreakdown} onChange={setFullBreakdown} label="Record the whole breakdown" />
      </div>

      <div className="st-card st-row">
        <div>
          <h3>Minor stoppage limit</h3>
          <p>A stop shorter than this is a <em>Minor stoppage</em>; a longer one is a <em>Breakdown</em>.</p>
        </div>
        <label className="st-number">
          <input type="number" min={10} max={3600} step={10} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Minor stoppage limit in seconds" />
          <span>seconds{limitValid ? ` (${limitNumber % 60 === 0 ? `${limitNumber / 60} min` : `${limitNumber} s`})` : ''}</span>
        </label>
      </div>
      {!limitValid && <p className="st-error">Enter a limit between 10 and 3600 seconds.</p>}

      <div className="st-actions">
        <button type="button" className="er-btn er-btn-primary" disabled={!dirty || !limitValid || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save rules'}
        </button>
        {!dirty && <span className="st-muted">No changes</span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- storage */

function StorageTab({ settings, stats, onSave }: { settings: CameraSettings; stats: RecordingStats; onSave: (patch: Partial<CameraSettings>) => Promise<boolean> }) {
  const [root, setRoot] = useState(settings.storage_root);
  const [helperUrl, setHelperUrl] = useState(settings.public_helper_url || '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setRoot(settings.storage_root); }, [settings.storage_root]);
  useEffect(() => { setHelperUrl(settings.public_helper_url || ''); }, [settings.public_helper_url]);

  const dirty = root.trim() !== settings.storage_root || helperUrl.trim() !== (settings.public_helper_url || '');
  const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

  async function save() {
    if (!root.trim()) return;
    setSaving(true);
    await onSave({ storage_root: root.trim(), public_helper_url: helperUrl.trim() });
    setSaving(false);
  }

  return (
    <div className="st-section">
      <div className="st-stats">
        <div><span>Saved recordings</span><strong>{stats.storage.video_count || 0}</strong></div>
        <div><span>Space used</span><strong>{gb(stats.storage.total || 0)}</strong></div>
      </div>

      <div className="st-card">
        <h3>Recordings folder</h3>
        <p>Videos are saved here, sorted by year, month, day and camera. Change it only if your IT team asks.</p>
        <input className="st-input" type="text" value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Recordings folder" />
      </div>

      <div className="st-card">
        <button type="button" className="st-link" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
          {showAdvanced ? '▾' : '▸'} Advanced: address used in Excel video links
        </button>
        {showAdvanced && (
          <>
            <p>The "View Video" links in the Excel export open this address. Leave empty to use this server.</p>
            <input className="st-input" type="text" value={helperUrl} placeholder="http://192.168.100.136:8010"
              onChange={(e) => setHelperUrl(e.target.value)} aria-label="Address used in Excel video links" />
          </>
        )}
      </div>

      <div className="st-actions">
        <button type="button" className="er-btn er-btn-primary" disabled={!dirty || !root.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save storage'}
        </button>
        {!dirty && <span className="st-muted">No changes</span>}
      </div>
    </div>
  );
}
