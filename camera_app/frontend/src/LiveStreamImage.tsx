import { CSSProperties, useEffect, useRef } from 'react';

export type LiveStreamStatus = 'connecting' | 'live' | 'reconnecting';

type Props = {
  src: string;
  alt: string;
  style?: CSSProperties;
  onStatus?: (status: LiveStreamStatus) => void;
  /** Reconnect when no frame has arrived for this long. The server sends at least one frame a second. */
  stallMs?: number;
};

const SOI0 = 0xff;
const SOI1 = 0xd8;
const EOI1 = 0xd9;

/**
 * MJPEG viewer that heals itself. A plain <img src=".../mjpeg"> freezes on the last picture when
 * the connection drops (network blip, backend restart, proxy timeout) and only a page refresh
 * brings it back. This reads the stream with fetch, shows each JPEG, and reconnects when the
 * stream ends, errors or goes silent, and when the tab becomes visible again.
 */
export default function LiveStreamImage({ src, alt, style, onStatus, stallMs = 8000 }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let lastFrameAt = Date.now();
    let attempt = 0;
    let retryTimer: number | undefined;
    let shownUrl = '';
    let status: LiveStreamStatus | null = null;

    const setStatus = (next: LiveStreamStatus) => {
      if (next !== status) {
        status = next;
        onStatusRef.current?.(next);
      }
    };

    const show = (jpeg: Uint8Array) => {
      const img = imgRef.current;
      if (!img) return;
      const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
      const previous = shownUrl;
      shownUrl = url;
      img.src = url;
      if (previous) URL.revokeObjectURL(previous);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      controller?.abort();
      controller = null;
      window.clearTimeout(retryTimer);
      setStatus('reconnecting');
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      attempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    async function connect() {
      if (disposed) return;
      const own = new AbortController();
      controller = own;
      lastFrameAt = Date.now();
      if (status !== 'reconnecting') setStatus('connecting');
      try {
        const sep = src.includes('?') ? '&' : '?';
        const response = await fetch(`${src}${sep}_r=${Date.now()}`, { cache: 'no-store', signal: own.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        let buffer = new Uint8Array(0);
        for (;;) {
          const { done, value } = await reader.read();
          if (done || own.signal.aborted) break;
          const merged = new Uint8Array(buffer.length + value.length);
          merged.set(buffer);
          merged.set(value, buffer.length);
          buffer = merged;

          // Show only the newest complete JPEG in the buffer; drop older ones.
          let latest: Uint8Array | null = null;
          let consumed = 0;
          for (;;) {
            const start = findMarker(buffer, SOI1, consumed);
            if (start < 0) break;
            const end = findMarker(buffer, EOI1, start + 2);
            if (end < 0) {
              consumed = start;
              break;
            }
            latest = buffer.subarray(start, end + 2);
            consumed = end + 2;
          }
          if (latest) {
            show(latest.slice());
            lastFrameAt = Date.now();
            attempt = 0;
            setStatus('live');
          }
          if (consumed > 0) buffer = buffer.slice(consumed);
          if (buffer.length > 8 * 1024 * 1024) buffer = new Uint8Array(0); // garbage, resync
        }
      } catch {
        // aborted or network error: fall through to reconnect
      }
      if (controller === own) scheduleReconnect();
    }

    const watchdog = window.setInterval(() => {
      if (controller && Date.now() - lastFrameAt > stallMs) scheduleReconnect();
    }, 2000);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFrameAt > 3000) {
        attempt = 0;
        scheduleReconnect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    connect();

    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      if (shownUrl) URL.revokeObjectURL(shownUrl);
    };
  }, [src, stallMs]);

  return <img ref={imgRef} alt={alt} style={style} />;
}

/** Index of 0xFF <second> at or after `from`, or -1. */
function findMarker(buffer: Uint8Array, second: number, from: number): number {
  let i = buffer.indexOf(SOI0, from);
  while (i >= 0 && i < buffer.length - 1) {
    if (buffer[i + 1] === second) return i;
    i = buffer.indexOf(SOI0, i + 1);
  }
  return -1;
}
