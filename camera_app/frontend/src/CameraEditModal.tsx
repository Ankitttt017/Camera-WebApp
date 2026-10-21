import React, { useState } from 'react';
import { FlatCamera, updateCamera, testCameraConnection } from './api';

interface CameraEditModalProps {
  camera: FlatCamera;
  onClose: () => void;
  onSaved: () => void;
}

export function CameraEditModal({ camera, onClose, onSaved }: CameraEditModalProps) {
  const [name, setName] = useState(camera.name);
  const [cameraIp, setCameraIp] = useState(camera.camera_ip);
  const [httpPort, setHttpPort] = useState(camera.http_port || 80);
  const [rtspPort, setRtspPort] = useState(camera.rtsp_port || 554);
  const [username, setUsername] = useState(camera.username || 'admin');
  const [password, setPassword] = useState(camera.password || 'Admin@123');
  const [channel, setChannel] = useState(camera.channel || 1);
  const [rtspPath, setRtspPath] = useState(camera.rtsp_path || '/video/live?channel=1&subtype=0');
  const [subRtspPath, setSubRtspPath] = useState(camera.sub_rtsp_path || '/video/live?channel=1&subtype=1');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testCameraConnection({
        camera_ip: cameraIp,
        http_port: Number(httpPort),
        rtsp_port: Number(rtspPort),
        username,
        password,
        channel: Number(channel),
        rtsp_path: rtspPath
      });
      setTestResult({
        ok: res.rtsp_stream_ok || (res.ping && res.rtsp_open),
        message: res.message
      });
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err.message || 'Connection test failed'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateCamera(camera.id, {
        name,
        camera_ip: cameraIp,
        http_port: Number(httpPort),
        rtsp_port: Number(rtspPort),
        username,
        password,
        channel: Number(channel),
        rtsp_path: rtspPath,
        sub_rtsp_path: subRtspPath,
        is_active: true
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update camera');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: '#ffffff',
    border: '1.5px solid #cbd5e1',
    borderRadius: '8px',
    color: '#0f172a',
    fontSize: '0.92rem',
    outline: 'none',
    boxSizing: 'border-box'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.84rem',
    color: '#475569',
    fontWeight: 700,
    marginBottom: '6px'
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1.5px solid #e2e8f0',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '560px',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.12)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: '18px 24px',
          background: '#f8fafc',
          borderBottom: '1.5px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>✏️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a', fontWeight: 800 }}>
                Edit Camera Configuration
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Machine: <strong style={{ color: '#1d4ed8' }}>{camera.machine_name}</strong> • ID #{camera.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '1.3rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {error && (
            <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600 }}>
              {error}
            </div>
          )}

          {/* Camera Name */}
          <div>
            <label style={labelStyle}>
              Camera Label / Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* IP & Ports */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>
                Camera IP Address
              </label>
              <input
                type="text"
                required
                value={cameraIp}
                onChange={(e) => setCameraIp(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>
                RTSP Port
              </label>
              <input
                type="number"
                required
                value={rtspPort}
                onChange={(e) => setRtspPort(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>
                Channel
              </label>
              <input
                type="number"
                required
                value={channel}
                onChange={(e) => setChannel(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Username & Password */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>
                Password
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* RTSP Stream Path */}
          <div>
            <label style={labelStyle}>
              RTSP Main Stream URL / Path
            </label>
            <input
              type="text"
              value={rtspPath}
              onChange={(e) => setRtspPath(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Live Test Connection Area */}
          <div style={{
            background: '#f8fafc',
            padding: '14px 18px',
            borderRadius: '10px',
            border: '1.5px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div>
              <span style={{ fontSize: '0.84rem', color: '#64748b', display: 'block', fontWeight: 600 }}>Network Verification</span>
              {testResult ? (
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: testResult.ok ? '#15803d' : '#dc2626' }}>
                  {testResult.ok ? '✅ ' : '⚠️ '} {testResult.message}
                </span>
              ) : (
                <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Test camera IP and RTSP handshake</span>
              )}
            </div>
            <button
              type="button"
              disabled={testing}
              onClick={handleTest}
              style={{
                padding: '8px 16px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1d4ed8',
                borderRadius: '8px',
                fontSize: '0.86rem',
                cursor: testing ? 'not-allowed' : 'pointer',
                fontWeight: 700
              }}
            >
              {testing ? 'Testing...' : '⚡ Test Stream'}
            </button>
          </div>

          {/* Modal Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px', borderTop: '1.5px solid #e2e8f0', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 20px',
                background: '#ffffff',
                border: '1.5px solid #cbd5e1',
                color: '#475569',
                borderRadius: '8px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '9px 24px',
                background: '#2563eb',
                border: 'none',
                color: '#fff',
                borderRadius: '8px',
                fontSize: '0.9rem',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)'
              }}
            >
              {saving ? 'Saving...' : '💾 Save Changes'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
