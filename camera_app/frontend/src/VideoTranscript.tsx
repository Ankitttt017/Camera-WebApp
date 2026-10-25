import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordingTranscript, TranscriptSegment } from './api';

/** Keep a caption on screen a little after the words end so it can be read. */
const CAPTION_HOLD_SECONDS = 1.2;

function usePlayerTime(playerRef: RefObject<HTMLVideoElement | null>, videoKey: string) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const update = () => setTime(player.currentTime);
    player.addEventListener('timeupdate', update);
    player.addEventListener('seeked', update);
    return () => {
      player.removeEventListener('timeupdate', update);
      player.removeEventListener('seeked', update);
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
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function clockAt(startedAt: string | null, offset: number) {
  if (!startedAt) return '';
  const base = new Date(startedAt);
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() + offset * 1000).toLocaleTimeString('en-GB', { hour12: false });
}

function vttTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
}

function toVtt(segments: TranscriptSegment[]) {
  const cues = segments.map((segment, i) => {
    const next = segments[i + 1]?.start ?? Infinity;
    const end = Math.min(segment.end + CAPTION_HOLD_SECONDS, next);
    return `${vttTime(segment.start)} --> ${vttTime(Math.max(end, segment.start + 0.5))}\n${segment.text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/**
 * Operator's words as real subtitles (WebVTT). The browser draws them inside the picture, moves
 * them above the player controls and offers the CC on/off switch, like any video player.
 * Render it as a child of the <video>.
 */
export function CaptionTrack({
  playerRef,
  segments,
}: {
  playerRef: RefObject<HTMLVideoElement | null>;
  segments: TranscriptSegment[];
}) {
  const url = useMemo(
    () => (segments.length ? URL.createObjectURL(new Blob([toVtt(segments)], { type: 'text/vtt' })) : ''),
    [segments],
  );
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    const tracks = playerRef.current?.textTracks;
    if (!url || !tracks) return;
    // a track added after the video loaded is not switched on by `default`; do it explicitly
    const show = () => { for (let i = 0; i < tracks.length; i += 1) tracks[i].mode = 'showing'; };
    show();
    const timer = window.setTimeout(show, 300);
    return () => window.clearTimeout(timer);
  }, [url, playerRef]);
  if (!url) return null;
  return <track key={url} kind="subtitles" srcLang="hi" label="Operator voice" src={url} default />;
}

export type EventSummary = {
  typeLabel: string;
  tone: 'red' | 'amber' | 'slate';
  when: string;
  duration: string;
  reason: string;
};

/** Side panel: the event at a glance, then every voice note with its time; click a line to replay it. */
export function TranscriptPanel({
  playerRef,
  videoKey,
  data,
  loading,
  summary,
}: {
  playerRef: RefObject<HTMLVideoElement | null>;
  videoKey: string;
  data: RecordingTranscript | null;
  loading: boolean;
  summary: EventSummary;
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
        <p className="vt-note">Timings are saved only for recordings transcribed after the 25 Oct update.</p>
      </div>
    );
  } else if (data?.transcript_status === 'processing' || data?.transcript_status === 'pending') {
    body = <p className="vt-empty">Transcription in progress…</p>;
  } else {
    body = <p className="vt-empty">No operator speech detected in this recording.</p>;
  }

  return (
    <aside className="vt-panel" aria-label="Event details and operator voice transcript">
      <section className="vt-event">
        <span className={`vt-badge vt-badge-${summary.tone}`}>{summary.typeLabel}</span>
        <dl>
          <div>
            <dt>Started</dt>
            <dd>{summary.when}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{summary.duration}</dd>
          </div>
          <div className="vt-event-wide">
            <dt>Downtime reason</dt>
            <dd className={summary.reason ? '' : 'is-missing'}>{summary.reason || 'Not entered yet'}</dd>
          </div>
        </dl>
      </section>

      <header className="vt-head">
        <h3>Operator voice</h3>
        {segments.length > 0 && <span className="vt-count">{segments.length}</span>}
      </header>
      {body}
      <p className="vt-foot">Auto transcript from the recording audio. Listen to confirm before using it as the reason.</p>
    </aside>
  );
}
