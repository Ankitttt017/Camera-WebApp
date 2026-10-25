import { RefObject, useEffect, useRef, useState } from 'react';
import type { RecordingTranscript, TranscriptSegment } from './api';

/** Keep a caption on screen a little after the words end so it can be read. */
const CAPTION_HOLD_SECONDS = 1.2;

function usePlayerTime(playerRef: RefObject<HTMLVideoElement | null>, videoKey: string) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      if (Math.abs(player.currentTime - last) >= 0.1) {
        last = player.currentTime;
        setTime(last);
      }
      frame = player.paused ? 0 : requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const update = () => setTime(player.currentTime);
    player.addEventListener('play', start);
    player.addEventListener('seeked', update);
    player.addEventListener('timeupdate', update);
    start();
    return () => {
      cancelAnimationFrame(frame);
      player.removeEventListener('play', start);
      player.removeEventListener('seeked', update);
      player.removeEventListener('timeupdate', update);
    };
  }, [playerRef, videoKey]);
  return time;
}

function activeIndex(segments: TranscriptSegment[], time: number, hold: number) {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (time >= segments[i].start - 0.15 && time <= segments[i].end + hold) return i;
  }
  return -1;
}

function formatOffset(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function clockAt(startedAt: string | null, offset: number) {
  if (!startedAt) return '';
  const base = new Date(startedAt);
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() + offset * 1000).toLocaleTimeString('en-GB', { hour12: false });
}

/** What the operator is saying right now, shown over the bottom of the video. */
export function VideoCaption({
  playerRef,
  videoKey,
  segments,
}: {
  playerRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  segments: TranscriptSegment[];
}) {
  const time = usePlayerTime(playerRef, videoKey);
  const index = activeIndex(segments, time, CAPTION_HOLD_SECONDS);
  if (index < 0) return null;
  return (
    <div className="vt-caption" aria-live="polite">
      <span className="vt-caption-text">{segments[index].text}</span>
    </div>
  );
}

/** Side panel listing every voice note with its time; click a line to hear it again. */
export function TranscriptPanel({
  playerRef,
  videoKey,
  data,
  loading,
}: {
  playerRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  data: RecordingTranscript | null;
  loading: boolean;
}) {
  const time = usePlayerTime(playerRef, videoKey);
  const listRef = useRef<HTMLOListElement | null>(null);
  const segments = data?.segments || [];
  const index = activeIndex(segments, time, 0.3);

  useEffect(() => {
    if (index < 0 || !listRef.current) return;
    const item = listRef.current.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [index]);

  function seek(segment: TranscriptSegment) {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = Math.max(0, segment.start - 0.3);
    player.play().catch(() => {});
  }

  let body;
  if (loading) {
    body = <p className="vt-empty">Loading transcript…</p>;
  } else if (segments.length) {
    body = (
      <ol className="vt-list" ref={listRef}>
        {segments.map((segment, i) => (
          <li key={`${segment.start}-${i}`}>
            <button
              type="button"
              className={i === index ? 'vt-line is-active' : 'vt-line'}
              onClick={() => seek(segment)}
              title="Play from here"
            >
              <span className="vt-time">
                <strong>{formatOffset(segment.start)}</strong>
                {data?.started_at && <small>{clockAt(data.started_at, segment.start)}</small>}
              </span>
              <span className="vt-text">{segment.text}</span>
            </button>
          </li>
        ))}
      </ol>
    );
  } else if (data?.transcript) {
    body = (
      <div className="vt-plain">
        <p className="vt-text">{data.transcript}</p>
        <p className="vt-note">Exact timings are saved for recordings transcribed from now on.</p>
      </div>
    );
  } else if (data?.transcript_status === 'processing' || data?.transcript_status === 'pending') {
    body = <p className="vt-empty">Transcription in progress…</p>;
  } else {
    body = <p className="vt-empty">No operator speech detected in this recording.</p>;
  }

  return (
    <aside className="vt-panel" aria-label="Operator voice transcript">
      <header className="vt-head">
        <span className="vt-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
          </svg>
        </span>
        <div>
          <h3>Operator voice</h3>
          <p>Auto transcript · verify with the audio</p>
        </div>
        {segments.length > 0 && <span className="vt-count">{segments.length}</span>}
      </header>
      {body}
    </aside>
  );
}
