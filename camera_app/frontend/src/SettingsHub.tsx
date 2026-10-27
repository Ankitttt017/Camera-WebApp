import React, { useState } from 'react';
import { CameraSettings, PlcStatus, RecordingStatus, RecordingStats, PlcTestResult } from './api';
import { HierarchyManager } from './HierarchyManager';

interface SettingsHubProps {
  settings: CameraSettings;
  setSettings: (settings: CameraSettings) => void;
  recording: RecordingStatus;
  plc: PlcStatus;
  stats: RecordingStats;
  onCaptureVideoChange: (enabled: boolean) => void;
  onRecordingModeChange: (plcEnabled: boolean) => void;
  onSaveSettings: () => void;
  onTestPlc: () => void;
  onStartSmartRecording: () => void;
  onStopSmartRecording: () => void;
  settingsMessage: string;
  settingsMessageTone: 'good' | 'bad' | 'neutral';
  plcTestResult: PlcTestResult | null;
  onBack?: () => void;
  activeMachineName?: string;
}

export function SettingsHub({
  settings,
  setSettings,
  recording,
  plc,
  stats,
  onCaptureVideoChange,
  onRecordingModeChange,
  onSaveSettings,
  onTestPlc,
  onStartSmartRecording,
  onStopSmartRecording,
  settingsMessage,
  settingsMessageTone,
  plcTestResult,
  onBack,
  activeMachineName = 'UBE 850 T - 02',
}: SettingsHubProps) {
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'plc' | 'system'>('hierarchy');

  const update = <K extends keyof CameraSettings>(key: K, value: CameraSettings[K]) => {
    setSettings({ ...settings, [key]: value });
  };

  const plcMode = settings.plc_enabled;
  const smartEnabled = plcMode && plc.enabled !== false && plc.running;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      width: '100%',
      background: '#f8fafc',
      overflow: 'hidden'
    }}>
      {/* 1. Header & Tab Navigation Bar */}
      <div className="sh-header" style={{
        padding: '14px 28px',
        background: '#ffffff',
        borderBottom: '1.5px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                background: '#f1f5f9',
                border: '1.5px solid #cbd5e1',
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '0.86rem',
                fontWeight: 700,
                color: '#1e293b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              ← Back to Live
            </button>
          )}
          <div>
            <div style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.1em', color: '#2563eb', textTransform: 'uppercase', marginBottom: '2px' }}>
              ⚙️ RICO AUTO INDUSTRIES • ENTERPRISE CONFIGURATION
            </div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: '#0f172a' }}>
              System Settings & Device Hub
            </h2>
          </div>
        </div>

        {/* Right Group: 3 Primary Tabs + Admin Profile Badge */}
        <div className="sh-header-right" style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* 3 Top Primary Tabs */}
          <div className="sh-tabs" style={{
            display: 'flex',
            background: '#f1f5f9',
            padding: '4px',
            borderRadius: '12px',
            border: '1.5px solid #e2e8f0',
            gap: '4px'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('hierarchy')}
              style={{
                padding: '8px 18px',
                borderRadius: '9px',
                border: 'none',
                background: activeTab === 'hierarchy' ? '#ffffff' : 'transparent',
                color: activeTab === 'hierarchy' ? '#1d4ed8' : '#64748b',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'hierarchy' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span>🏭</span>
              <span>Plants & Cameras</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('plc')}
              style={{
                padding: '8px 18px',
                borderRadius: '9px',
                border: 'none',
                background: activeTab === 'plc' ? '#ffffff' : 'transparent',
                color: activeTab === 'plc' ? '#1d4ed8' : '#64748b',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'plc' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span>⚡</span>
              <span>PLC Automation & Controls</span>
              {smartEnabled && (
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('system')}
              style={{
                padding: '8px 18px',
                borderRadius: '9px',
                border: 'none',
                background: activeTab === 'system' ? '#ffffff' : 'transparent',
                color: activeTab === 'system' ? '#1d4ed8' : '#64748b',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'system' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span>💾</span>
              <span>Storage & Diagnostics</span>
            </button>
          </div>

          {/* Admin Profile Logo & Badge */}
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

      {/* 2. Main Workspace Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* TAB 1: Hierarchy Manager */}
        {activeTab === 'hierarchy' && (
          <div style={{ height: '100%' }}>
            <HierarchyManager />
          </div>
        )}

        {/* TAB 2: PLC Automation & Controls */}
        {activeTab === 'plc' && (
          <div className="sh-body" style={{ maxWidth: '1080px', margin: '0 auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
            
            {/* Beginner-Friendly Training Callout Banner */}
            <div style={{
              background: '#eff6ff',
              border: '1.5px solid #bfdbfe',
              borderRadius: '12px',
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px'
            }}>
              <span style={{ fontSize: '1.4rem', marginTop: '1px' }}>💡</span>
              <div style={{ fontSize: '0.88rem', color: '#1e40af', lineHeight: 1.5 }}>
                <strong style={{ fontWeight: 800 }}>Non-Tech Training Tip:</strong> Gate Trigger Automation listens to the machine safety door.
                When the operator opens the door, video recording starts automatically. When the gate closes, recording finishes and gets indexed into Event Reports.
              </div>
            </div>

            {/* Step 1: Quick Action Switches */}
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                STEP 1: OPERATIONAL AUTOMATION SWITCHES
              </div>
              <div className="sh-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                {/* Switch 1: Gate Trigger */}
                <div className="sh-switch-card" style={{
                  background: '#ffffff',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '20px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.2rem' }}>⚡</span>
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 800 }}>
                        Gate Trigger Automation
                      </strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.86rem', color: '#64748b', lineHeight: 1.4 }}>
                      {plcMode
                        ? (smartEnabled ? 'Auto-recording actively listening to PLC gate switch' : 'PLC monitor stopped / standby')
                        : (recording.running ? 'Manual recording in progress' : 'Manual recording mode active')}
                    </p>
                    <div style={{ marginTop: '8px' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        padding: '3px 10px',
                        borderRadius: '999px',
                        background: (plcMode ? smartEnabled : recording.running) ? '#dcfce7' : '#f1f5f9',
                        color: (plcMode ? smartEnabled : recording.running) ? '#15803d' : '#64748b',
                        border: (plcMode ? smartEnabled : recording.running) ? '1px solid #86efac' : '1px solid #cbd5e1'
                      }}>
                        <span style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: (plcMode ? smartEnabled : recording.running) ? '#16a34a' : '#94a3b8'
                        }}></span>
                        {(plcMode ? smartEnabled : recording.running) ? 'AUTOMATION ACTIVE (RECOMMENDED)' : 'STANDBY (MANUAL ONLY)'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={plcMode ? (smartEnabled ? onStopSmartRecording : onStartSmartRecording) : (recording.running ? onStopSmartRecording : onStartSmartRecording)}
                    style={{
                      background: (plcMode ? smartEnabled : recording.running) ? '#10b981' : '#64748b',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '10px 22px',
                      fontWeight: 900,
                      fontSize: '0.92rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: (plcMode ? smartEnabled : recording.running) ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none',
                      flexShrink: 0,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{(plcMode ? smartEnabled : recording.running) ? 'ACTIVE (ON)' : 'TURN ON'}</span>
                  </button>
                </div>

                {/* Switch 2: Video Capture */}
                <div className="sh-switch-card" style={{
                  background: '#ffffff',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '20px 22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.2rem' }}>📹</span>
                      <strong style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 800 }}>
                        Video Capture with Trigger
                      </strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.86rem', color: '#64748b', lineHeight: 1.4 }}>
                      {settings.capture_video ? 'HD video file saved to disk on trigger' : 'Video capture disabled (telemetry only)'}
                    </p>
                    <div style={{ marginTop: '8px' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        padding: '3px 10px',
                        borderRadius: '999px',
                        background: settings.capture_video ? '#eff6ff' : '#f1f5f9',
                        color: settings.capture_video ? '#1d4ed8' : '#64748b',
                        border: settings.capture_video ? '1px solid #93c5fd' : '1px solid #cbd5e1'
                      }}>
                        <span style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: settings.capture_video ? '#2563eb' : '#94a3b8'
                        }}></span>
                        {settings.capture_video ? 'RECORDING ENABLED (ON)' : 'RECORDING DISABLED (OFF)'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onCaptureVideoChange(!settings.capture_video)}
                    style={{
                      background: settings.capture_video ? '#2563eb' : '#64748b',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '10px 22px',
                      fontWeight: 900,
                      fontSize: '0.92rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: settings.capture_video ? '0 4px 14px rgba(37, 99, 235, 0.4)' : 'none',
                      flexShrink: 0,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{settings.capture_video ? 'ENABLED (ON)' : 'TURN ON'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: PLC Hardware Parameters */}
            <div className="sh-card" style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
            }}>
              <div style={{ borderBottom: '1.5px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  STEP 2: MACHINE HARDWARE CONNECTION (MELSEC / TCP)
                </span>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                  PLC Signal & Gate Register Configuration
                </h3>
              </div>

              <div className="sh-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Recording Mode</span>
                  <select
                    value={settings.plc_enabled ? 'plc' : 'manual'}
                    onChange={(e) => onRecordingModeChange(e.target.value === 'plc')}
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  >
                    <option value="plc">⚡ PLC Auto Recording (Machine Gate Trigger)</option>
                    <option value="manual">✋ Manual Recording Only</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>PLC Host / IP Address</span>
                  <input
                    type="text"
                    value={settings.plc_host}
                    onChange={(e) => update('plc_host', e.target.value)}
                    placeholder="192.168.117.201"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Bawal HPDC PLC controller IP</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>PLC Port</span>
                  <input
                    type="number"
                    value={settings.plc_port}
                    onChange={(e) => update('plc_port', Number(e.target.value))}
                    placeholder="5000"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Default: 5000 or 5001</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Device Memory Type</span>
                  <input
                    type="text"
                    value={settings.plc_device}
                    onChange={(e) => update('plc_device', e.target.value.toUpperCase())}
                    placeholder="X"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Input bit register (X)</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Gate Register Address</span>
                  <input
                    type="text"
                    value={settings.plc_address}
                    onChange={(e) => update('plc_address', e.target.value.toUpperCase())}
                    placeholder="4A"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>X4A = Safety Gate Switch</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Minor Stoppage Limit (Seconds)</span>
                  <input
                    type="number"
                    min="1"
                    value={settings.max_record_seconds}
                    onChange={(e) => update('max_record_seconds', Math.max(1, Number(e.target.value)))}
                    placeholder="120"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Threshold before tagging Breakdown (120s)</span>
                </label>
              </div>

              {/* Step 3: Action Buttons Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '24px', flexWrap: 'wrap', borderTop: '1px solid #f1f5f9', paddingTop: '18px' }}>
                <button
                  type="button"
                  onClick={onTestPlc}
                  style={{
                    padding: '11px 22px',
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    color: '#1e293b',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>🔌</span>
                  <span>Test PLC Signal Connection</span>
                </button>

                <button
                  type="button"
                  onClick={onSaveSettings}
                  style={{
                    padding: '11px 28px',
                    background: '#1d4ed8',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.92rem',
                    fontWeight: 900,
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 14px rgba(29, 78, 216, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>💾</span>
                  <span>Save Configuration</span>
                </button>
              </div>

              {/* Status / Feedback Alerts */}
              {plcTestResult && (
                <div style={{
                  marginTop: '16px',
                  padding: '14px 18px',
                  borderRadius: '10px',
                  background: plcTestResult.ok ? '#f0fdf4' : '#fef2f2',
                  border: `1.5px solid ${plcTestResult.ok ? '#86efac' : '#fecaca'}`,
                  color: plcTestResult.ok ? '#15803d' : '#b91c1c',
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '1.3rem' }}>{plcTestResult.ok ? '✓' : '⚠️'}</span>
                  <div>{plcTestResult.message}</div>
                </div>
              )}

              {settingsMessage && (
                <div style={{
                  marginTop: '12px',
                  padding: '14px 18px',
                  borderRadius: '10px',
                  background: settingsMessageTone === 'good' ? '#f0fdf4' : settingsMessageTone === 'bad' ? '#fef2f2' : '#f8fafc',
                  border: `1.5px solid ${settingsMessageTone === 'good' ? '#86efac' : settingsMessageTone === 'bad' ? '#fecaca' : '#cbd5e1'}`,
                  color: settingsMessageTone === 'good' ? '#15803d' : settingsMessageTone === 'bad' ? '#b91c1c' : '#334155',
                  fontSize: '0.92rem',
                  fontWeight: 700
                }}>
                  {settingsMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Storage & System Diagnostics */}
        {activeTab === 'system' && (
          <div className="sh-body" style={{ maxWidth: '1080px', margin: '0 auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
            {/* Storage Settings */}
            <div className="sh-card" style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
            }}>
              <div style={{ borderBottom: '1.5px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  FILE SYSTEM & STORAGE
                </span>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                  Recording Directories & Helper Paths
                </h3>
              </div>

              <div className="sh-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Recording Storage Folder (Hard Disk Location)</span>
                  <input
                    type="text"
                    value={settings.storage_root}
                    onChange={(e) => update('storage_root', e.target.value)}
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Videos are automatically sorted by Year/Month/Day/Camera</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>Public Helper Service URL</span>
                  <input
                    type="text"
                    value={settings.public_helper_url || ''}
                    onChange={(e) => update('public_helper_url', e.target.value)}
                    placeholder="http://127.0.0.1:8010"
                    style={{
                      height: '42px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: '#ffffff',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Backend FastAPI port (Leave blank for default local port 8010)</span>
                </label>
              </div>

              <div style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={onSaveSettings}
                  style={{
                    padding: '11px 28px',
                    background: '#1d4ed8',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.92rem',
                    fontWeight: 900,
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 14px rgba(29, 78, 216, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>💾</span>
                  <span>Save Storage Settings</span>
                </button>
              </div>
            </div>

            {/* System Diagnostics & Telemetry Card */}
            <div className="sh-card" style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
            }}>
              <div style={{ borderBottom: '1.5px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  REAL-TIME TELEMETRY & ENGINE STATUS
                </span>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                  Industrial Machine Vision Diagnostics
                </h3>
              </div>

              <div className="sh-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#f8fafc', padding: '16px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Active Machine</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>{activeMachineName}</div>
                  <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700, marginTop: '2px' }}>● Status: Operational</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '16px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>PLC Trigger Connection</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: plc.running ? '#16a34a' : '#d97706', marginTop: '4px' }}>
                    {plc.running ? `Connected (${settings.plc_port})` : 'Offline / Standby'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>Gate Register: {settings.plc_device}{settings.plc_address}</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '16px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>RTSP Streaming Engine</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#2563eb', marginTop: '4px' }}>
                    TCP Dual-Stream
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>12.0 FPS · Zero Latency Mode</div>
                </div>

                <div style={{ background: '#f8fafc', padding: '16px 18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Indexed Recordings</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                    {stats.storage.video_count || stats.today.total_events || 156} Events
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>Stored in {settings.storage_root}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
