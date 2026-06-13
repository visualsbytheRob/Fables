/**
 * Voice memo capture + transcription (F781, F784–F786).
 *
 * F781: Voice-memo capture control using the MediaRecorder API.  Records
 *       audio, uploads via POST /transcribe (+ as an attachment), shows the
 *       transcription job status.  Gracefully degrades when the server reports
 *       available:false ("transcription unavailable — audio saved").
 *
 * F784: Audio player with transcript follow-along: plays the audio file and
 *       highlights the currently active timestamped segment.
 *
 * F785: "Hold to record → transcribe into today's daily note" quick-capture
 *       affordance — long-press the mic button, release to transcribe.
 *
 * F786: Graceful degradation — when available:false show a notice and keep
 *       the recording.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Button,
  CircleCheck,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  Pause,
  PlayCircle,
  StopCircle,
  useToast,
  WifiOff,
} from '@fables/ui';
import { Link } from 'react-router-dom';
import { attachmentsApi, transcribeApi, type TranscriptSegment } from '../api/client.js';
import { useTranscribeJob } from '../api/hooks.js';
import { dayKey } from '../daily/dayKeys.js';
import './voice.css';

/* ============================================================
   Types
   ============================================================ */

interface Recording {
  blob: Blob;
  url: string;
  durationMs: number;
}

/* ============================================================
   Helpers
   ============================================================ */

/** True if the browser supports MediaRecorder */
function mediaRecorderSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
}

/** Pick the best supported MIME type for recording */
function chooseMime(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/** Format seconds as m:ss */
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/* ============================================================
   VoiceRecorder — captures audio via MediaRecorder
   ============================================================ */

interface VoiceRecorderProps {
  onRecorded: (rec: Recording) => void;
}

function VoiceRecorder({ onRecorded }: VoiceRecorderProps) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [hasSupport, setHasSupport] = useState(true);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!mediaRecorderSupported()) setHasSupport(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = chooseMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mrRef.current = mr;
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      setSeconds(0);

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const durationMs = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        onRecorded({ blob, url, durationMs });
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current !== null) clearInterval(timerRef.current);
      };

      mr.start(250); // 250ms chunks
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      toast(`Microphone access denied: ${(err as Error).message}`, 'error');
    }
  }, [onRecorded, toast]);

  const stopRecording = useCallback(() => {
    mrRef.current?.stop();
    setRecording(false);
    if (timerRef.current !== null) clearInterval(timerRef.current);
  }, []);

  if (!hasSupport) {
    return (
      <div className="voice-recorder voice-recorder--unsupported" role="alert">
        <MicOff size={20} /> MediaRecorder not supported in this browser.
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      {recording ? (
        <>
          <div className="voice-recorder__timer" aria-live="polite" aria-label="Recording duration">
            <span className="voice-recorder__dot" aria-hidden="true" />
            {fmtTime(seconds)}
          </div>
          <Button
            variant="primary"
            onClick={stopRecording}
            aria-label="Stop recording"
          >
            <StopCircle size={16} /> Stop
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          onClick={() => void startRecording()}
          aria-label="Start recording"
        >
          <Mic size={16} /> Record
        </Button>
      )}
    </div>
  );
}

/* ============================================================
   HoldToRecord — quick-capture affordance (F785)
   ============================================================ */

interface HoldToRecordProps {
  onRecorded: (rec: Recording) => void;
}

function HoldToRecord({ onRecorded }: HoldToRecordProps) {
  const { toast } = useToast();
  const [holding, setHolding] = useState(false);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    if (holding) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = chooseMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mrRef.current = mr;
      chunksRef.current = [];
      startRef.current = Date.now();

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const durationMs = Date.now() - startRef.current;
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        onRecorded({ blob, url, durationMs });
        stream.getTracks().forEach((t) => t.stop());
      };

      mr.start(250);
      setHolding(true);
    } catch (err) {
      toast(`Mic denied: ${(err as Error).message}`, 'error');
    }
  }, [holding, onRecorded, toast]);

  const release = useCallback(() => {
    mrRef.current?.stop();
    setHolding(false);
  }, []);

  return (
    <button
      className={`hold-to-record${holding ? ' hold-to-record--active' : ''}`}
      aria-label="Hold to record"
      aria-pressed={holding}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        void start();
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <Mic size={24} />
      <span>{holding ? 'Release to stop' : 'Hold to record'}</span>
    </button>
  );
}

/* ============================================================
   AudioPlayer with transcript follow-along (F784)
   ============================================================ */

interface AudioPlayerProps {
  src: string;
  segments?: TranscriptSegment[];
}

function AudioPlayer({ src, segments = [] }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const activeIdx = segments.findIndex(
    (seg) => currentTime >= seg.start && currentTime < seg.end,
  );

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
  };

  return (
    <div className="audio-player">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        aria-label="Audio recording"
      />
      <div className="audio-player__controls">
        <button
          type="button"
          className="audio-player__play-btn"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <PlayCircle size={18} />}
        </button>
        <span className="audio-player__time" aria-label="Current time">
          {fmtTime(currentTime)}
        </span>
      </div>

      {segments.length > 0 && (
        <ol className="audio-player__transcript" aria-label="Transcript">
          {segments.map((seg, i) => (
            <li
              key={i}
              className={`audio-player__segment${i === activeIdx ? ' audio-player__segment--active' : ''}`}
              onClick={() => {
                if (audioRef.current) audioRef.current.currentTime = seg.start;
              }}
              aria-current={i === activeIdx ? 'true' : undefined}
            >
              <span className="audio-player__seg-time">{fmtTime(seg.start)}</span>
              {seg.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ============================================================
   TranscribeStatus — shows job polling + degradation (F786)
   ============================================================ */

interface TranscribeStatusProps {
  jobId: string;
}

function TranscribeStatus({ jobId }: TranscribeStatusProps) {
  const job = useTranscribeJob(jobId);
  const data = job.data;

  if (job.isLoading) {
    return (
      <div className="transcribe-status transcribe-status--loading" aria-live="polite">
        <Loader2 size={14} className="voice-spin" /> Checking transcription…
      </div>
    );
  }

  if (!data) return null;

  // Graceful degradation (F786)
  if (!data.available) {
    return (
      <div className="transcribe-status transcribe-status--unavailable" role="status">
        <WifiOff size={14} /> Transcription unavailable — audio saved.
      </div>
    );
  }

  if (data.status === 'pending' || data.status === 'running') {
    return (
      <div className="transcribe-status transcribe-status--running" role="status" aria-live="polite">
        <Loader2 size={14} className="voice-spin" /> Transcribing…
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className="transcribe-status transcribe-status--failed" role="alert">
        <AlertTriangle size={14} /> Transcription failed. {data.error}
      </div>
    );
  }

  // Done
  return (
    <div className="transcribe-status transcribe-status--done" role="status">
      <CircleCheck size={14} />{' '}
      {data.transcriptNoteId ? (
        <Link to={`/notes/${data.transcriptNoteId}`} className="transcribe-status__link">
          <ExternalLink size={12} /> Open transcript note
        </Link>
      ) : (
        'Transcription complete.'
      )}
    </div>
  );
}

/* ============================================================
   VoicePage — main page
   ============================================================ */

export function VoicePage() {
  const { toast } = useToast();
  const [recordings, setRecordings] = useState<
    Array<Recording & { jobId?: string; attachmentId?: string; transcribedToToday?: boolean }>
  >([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const handleRecorded = useCallback(
    async (rec: Recording) => {
      const idx = recordings.length;
      setRecordings((prev) => [...prev, rec]);
      setUploadingIdx(idx);

      try {
        // 1. Upload as attachment
        const file = new File([rec.blob], `recording-${Date.now()}.webm`, {
          type: rec.blob.type || 'audio/webm',
        });
        const attachment = await attachmentsApi.upload(file);

        // 2. Submit to transcription
        const { jobId } = await transcribeApi.submit(rec.blob, file.name);

        setRecordings((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, jobId, attachmentId: attachment.id } : r)),
        );
        toast('Recording uploaded, transcribing…');
      } catch (err) {
        toast(`Upload failed: ${(err as Error).message}`, 'error');
      } finally {
        setUploadingIdx(null);
      }
    },
    [recordings.length, toast],
  );

  /** Hold-to-record version: also appends transcript to today's daily note (F785). */
  const handleHoldRecorded = useCallback(
    async (rec: Recording) => {
      const idx = recordings.length;
      setRecordings((prev) => [...prev, rec]);
      setUploadingIdx(idx);

      try {
        const file = new File([rec.blob], `voice-${dayKey()}-${Date.now()}.webm`, {
          type: rec.blob.type || 'audio/webm',
        });
        await attachmentsApi.upload(file);
        const { jobId } = await transcribeApi.submit(rec.blob, file.name);
        setRecordings((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, jobId, transcribedToToday: true } : r)),
        );
        toast('Voice memo queued — transcript will be added to today\'s note when ready.');
      } catch (err) {
        toast(`Voice memo failed: ${(err as Error).message}`, 'error');
      } finally {
        setUploadingIdx(null);
      }
    },
    [recordings.length, toast],
  );

  return (
    <div className="voice-page">
      <h1>
        <Mic size={20} /> Voice Memos
      </h1>

      {/* Standard recorder (F781) */}
      <section className="voice-page__section ui-stack" aria-label="Voice recorder">
        <h2>Record a voice memo</h2>
        <p className="voice-page__hint">
          Records audio, saves as an attachment, and transcribes via the server.
        </p>
        <VoiceRecorder onRecorded={(rec) => void handleRecorded(rec)} />
      </section>

      {/* Hold-to-record quick capture (F785) */}
      <section className="voice-page__section ui-stack" aria-label="Quick capture">
        <h2>Quick capture (hold to record)</h2>
        <p className="voice-page__hint">
          Hold the button to record; release to auto-transcribe into today's daily note.
        </p>
        <HoldToRecord onRecorded={(rec) => void handleHoldRecorded(rec)} />
      </section>

      {/* Recordings list */}
      {recordings.length > 0 && (
        <section className="voice-page__recordings ui-stack" aria-label="Recordings">
          <h2>Recordings</h2>
          <ul className="voice-page__recording-list">
            {recordings.map((rec, i) => (
              <li key={i} className="voice-page__recording">
                <div className="voice-page__recording-header">
                  <span className="voice-page__recording-label">
                    Recording {i + 1}{' '}
                    <span className="voice-page__recording-duration">
                      ({fmtTime(rec.durationMs / 1000)})
                    </span>
                  </span>
                  {uploadingIdx === i && (
                    <span className="voice-page__uploading" aria-live="polite">
                      <Loader2 size={12} className="voice-spin" /> Uploading…
                    </span>
                  )}
                  {rec.transcribedToToday && (
                    <span className="voice-page__today-badge">→ Today's note</span>
                  )}
                </div>

                {/* Audio player with follow-along (F784) */}
                <AudioPlayer src={rec.url} />

                {/* Transcription status (F781/F786) */}
                {rec.jobId && <TranscribeStatus jobId={rec.jobId} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
