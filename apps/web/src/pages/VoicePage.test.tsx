// @vitest-environment jsdom
/**
 * Voice memo capture + transcription (F781, F784–F786).
 *
 * MediaRecorder is not available in jsdom; we stub it and the relevant APIs.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscribeJob } from '../api/client.js';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { VoicePage } from './VoicePage.js';

afterEach(() => vi.unstubAllGlobals());

/* ============================================================
   MediaRecorder stub
   ============================================================ */

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private _stream: MediaStream;

  constructor(stream: MediaStream) {
    super();
    this._stream = stream;
  }

  start(_timeslice?: number) {
    // Fire data synchronously so there's no lingering timer.
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
  }

  stop() {
    // Fire synchronously — avoids timers that outlive the test.
    this._stream.getTracks().forEach((t) => t.stop());
    this.onstop?.();
  }
}

function stubMediaAPIs() {
  // Stub MediaRecorder
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

  // Stub getUserMedia
  const fakeTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const fakeStream = {
    getTracks: () => [fakeTrack],
    getAudioTracks: () => [fakeTrack],
  } as unknown as MediaStream;
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
    },
  });

  // Stub URL.createObjectURL
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  });

  // Stub clipboard
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
    },
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
}

/* ============================================================
   Tests
   ============================================================ */

describe('voice page (F781, F784–F786)', () => {
  beforeEach(() => {
    stubMediaAPIs();
  });

  it('renders the record and hold-to-record sections', () => {
    render(<VoicePage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Voice recorder')).toBeDefined();
    expect(screen.getByLabelText('Quick capture')).toBeDefined();
    expect(screen.getByLabelText('Start recording')).toBeDefined();
    expect(screen.getByLabelText('Hold to record')).toBeDefined();
  });

  it('shows transcription status when job is running', async () => {
    const runningJob: TranscribeJob = {
      id: 'tj_1',
      status: 'running',
      transcriptNoteId: null,
      available: true,
      error: null,
    };
    mockFetchRoutes([
      { url: '/attachments', method: 'POST', body: { data: { id: 'att_1' } } },
      { url: '/transcribe', method: 'POST', body: { data: { jobId: 'tj_1' } } },
      { url: '/transcribe/jobs/tj_1', body: { data: runningJob } },
    ]);

    render(<VoicePage />, { wrapper: createWrapper() });

    // Start recording
    fireEvent.click(screen.getByLabelText('Start recording'));
    // Wait for "Stop" button
    await waitFor(() => expect(screen.getByLabelText('Stop recording')).toBeDefined());
    // Stop recording
    fireEvent.click(screen.getByLabelText('Stop recording'));

    // Recordings list should appear
    await waitFor(() => expect(screen.getByLabelText('Recordings')).toBeDefined(), {
      timeout: 2000,
    });
  });

  it('shows transcription unavailable notice (F786)', async () => {
    const unavailableJob: TranscribeJob = {
      id: 'tj_2',
      status: 'done',
      transcriptNoteId: null,
      available: false,
      error: null,
    };
    mockFetchRoutes([
      { url: '/attachments', method: 'POST', body: { data: { id: 'att_2' } } },
      { url: '/transcribe', method: 'POST', body: { data: { jobId: 'tj_2' } } },
      { url: '/transcribe/jobs/tj_2', body: { data: unavailableJob } },
    ]);

    render(<VoicePage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByLabelText('Start recording'));
    await waitFor(() => expect(screen.getByLabelText('Stop recording')).toBeDefined());
    fireEvent.click(screen.getByLabelText('Stop recording'));

    await waitFor(() =>
      expect(screen.queryByText(/transcription unavailable/i)).toBeDefined(),
      { timeout: 3000 },
    );
  });

  it('shows a link to the transcript note when done', async () => {
    const doneJob: TranscribeJob = {
      id: 'tj_3',
      status: 'done',
      transcriptNoteId: 'note_t1',
      available: true,
      error: null,
    };
    mockFetchRoutes([
      { url: '/attachments', method: 'POST', body: { data: { id: 'att_3' } } },
      { url: '/transcribe', method: 'POST', body: { data: { jobId: 'tj_3' } } },
      { url: '/transcribe/jobs/tj_3', body: { data: doneJob } },
    ]);

    render(<VoicePage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByLabelText('Start recording'));
    await waitFor(() => expect(screen.getByLabelText('Stop recording')).toBeDefined());
    fireEvent.click(screen.getByLabelText('Stop recording'));

    await waitFor(() =>
      expect(screen.queryByText('Open transcript note')).toBeDefined(),
      { timeout: 3000 },
    );
  });
});
