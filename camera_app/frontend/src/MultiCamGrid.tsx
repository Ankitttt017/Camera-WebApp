import React, { useEffect, useState, useRef } from 'react';
import { FlatCamera, hierarchyCameraMjpegUrl } from './api';

interface MultiCamGridProps {
  cameras: FlatCamera[];
  totalCamerasCount?: number;
  selectedCameraId?: number | null;
  onSelectCamera: (cam: FlatCamera) => void;
  onFocusSingle?: (cam: FlatCamera) => void;
  onEditCamera?: (cam: FlatCamera) => void;
  onResetFilters?: () => void;
}

export function MultiCamGrid({
  cameras,
  totalCamerasCount,
  selectedCameraId,
  onSelectCamera,
  onFocusSingle,
  onResetFilters
}: MultiCamGridProps) {
  const [fullscreenElementId, setFullscreenElementId] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  // Listen to browser fullscreen change events
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        setFullscreenElementId(null);
      }
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setFullscreenElementId(null);
    } else {
      el.requestFullscreen()
        .then(() => setFullscreenElementId(id))
        .catch(() => {});
    }
  };

  if (cameras.length === 0) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', background: '#0f172a', borderRadius: '12px', border: '1px dashed #334155', color: '#94a3b8' }}>
        <p style={{ fontSize: '1.2rem', color: '#f1f5f9', marginBottom: '8px' }}>📹 No cameras match the selected filter.</p>
        <p style={{ fontSize: '0.9rem', marginBottom: '14px' }}>Try choosing another Plant, Department, or Line from the dropdowns above, or reset filters to view all cameras.</p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            style={{
              background: 'linear-gradient(135deg, #0284c7, #0369a1)',
              color: '#fff',
              border: 'none',
              padding: '8px 18px',
              borderRadius: '7px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Show All Cameras
          </button>
        )}
      </div>
    );
  }

  // Scalable responsive grid layout for any number of cameras (2, 4, 6, 8, etc.)
  const gridColumns = cameras.length === 1 
    ? '1fr' 
    : cameras.length <= 4 
    ? 'repeat(2, 1fr)' 
    : 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))';

  // Standard CCTV natural height (preserves 16:9 proportions without vertical stretch)
  const videoHeight = cameras.length === 1 
    ? 'clamp(400px, 68vh, 760px)' 
    : cameras.length <= 4 
    ? 'clamp(320px, 46vh, 480px)' 
    : 'clamp(250px, 35vh, 380px)';

  return (
    <div
      ref={gridContainerRef}
      className="multicam-grid-wrapper"
      style={{
        display: 'grid',
        gridTemplateColumns: gridColumns,
        gap: '16px',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Informative Filter Notification if cameras are filtered */}
      {totalCamerasCount !== undefined && cameras.length < totalCamerasCount && (
        <div style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(2, 132, 199, 0.12)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '8px',
          padding: '8px 16px',
          fontSize: '0.85rem',
          color: '#cbd5e1'
        }}>
          <span>Filtered view: Displaying <strong>{cameras.length}</strong> of <strong>{totalCamerasCount}</strong> total cameras across plants.</span>
          {onResetFilters && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onResetFilters(); }}
              style={{
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                padding: '4px 12px',
                borderRadius: '5px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              Show All Plants ({totalCamerasCount})
            </button>
          )}
        </div>
      )}

      {cameras.map(cam => {
        const isSelected = selectedCameraId === cam.id;
        const liveUrl = hierarchyCameraMjpegUrl(cam.id);
        const containerDomId = `camera-screen-container-${cam.id}`;
        const isCurrentlyFullscreen = fullscreenElementId === containerDomId;

        return (
          <div
            key={cam.id}
            onClick={() => onSelectCamera(cam)}
            style={{
              background: '#090d16',
              border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(51, 65, 85, 0.7)',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: isSelected ? '0 0 20px rgba(56, 189, 248, 0.35)' : '0 8px 24px rgba(0,0,0,0.4)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Ultra-Clean Card Header */}
            <div style={{
              padding: '10px 16px',
              background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ fontSize: '1.15rem' }}>📹</span>
                <strong style={{ fontSize: '1.05rem', color: '#f8fafc', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cam.name}
                </strong>
                <span style={{
                  fontSize: '0.8rem',
                  color: '#38bdf8',
                  background: 'rgba(2, 132, 199, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}>
                  {cam.machine_name}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.82rem',
                  fontWeight: 900,
                  letterSpacing: '0.06em',
                  color: '#4ade80',
                  background: 'rgba(34, 197, 94, 0.16)',
                  border: '1px solid rgba(34, 197, 94, 0.45)',
                  padding: '3px 10px',
                  borderRadius: '6px'
                }}>
                  <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', display: 'inline-block' }}></i>
                  LIVE
                </span>

                {onFocusSingle && (
                  <button
                    type="button"
                    title="Open Full Single Camera View"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFocusSingle(cam);
                    }}
                    style={{
                      background: 'rgba(2, 132, 199, 0.18)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.18s'
                    }}
                  >
                    <span>🔍 Single View</span>
                  </button>
                )}

                <button
                  type="button"
                  title="Expand to Fullscreen Monitor"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen(containerDomId);
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.18s'
                  }}
                >
                  <span>⛶</span>
                </button>
              </div>
            </div>

            {/* Video Screen Container - Edge to Edge, Zero Black Bars */}
            <div
              id={containerDomId}
              className="camera-screen-box"
              style={{
                position: 'relative',
                width: '100%',
                height: videoHeight,
                background: '#020617',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              <img
                key={liveUrl}
                src={liveUrl}
                alt={cam.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  display: 'block'
                }}
                onError={(e) => {
                  (e.target as HTMLElement).style.opacity = '0.4';
                }}
              />

              {/* Floating Exit Fullscreen Button */}
              {isCurrentlyFullscreen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen(containerDomId);
                  }}
                  style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    background: 'rgba(15, 23, 42, 0.9)',
                    backdropFilter: 'blur(8px)',
                    color: '#f8fafc',
                    border: '1px solid #475569',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '1rem',
                    zIndex: 100
                  }}
                >
                  ✕ Exit Fullscreen (Esc)
                </button>
              )}

              {/* Single Minimal Broadcast Overlay Badge (Bottom Left) */}
              <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '12px',
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(8px)',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
              }}>
                <span style={{ color: '#94a3b8' }}>{cam.plant_name}</span>
                <span style={{ color: '#475569' }}>•</span>
                <span style={{ color: '#cbd5e1' }}>{cam.line_name}</span>
                <span style={{ color: '#475569' }}>•</span>
                <span style={{ color: '#38bdf8' }}>{cam.camera_ip}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
