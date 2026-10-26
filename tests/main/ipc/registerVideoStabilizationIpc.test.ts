import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }));
vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler)),
  },
}));

import {
  createFfmpegStabilizationPreview,
  registerVideoStabilizationIpc,
  type CreateStabilizationPreview,
} from '../../../src/main/ipc/registerVideoStabilizationIpc';
import {
  DiagnosticSessionStore,
  type SourceFingerprint,
  type RetainedDiagnosticSession,
} from '../../../src/main/ipc/registerVideoDiagnosticsIpc';
import { MediaJobCoordinator } from '../../../src/main/media-jobs/mediaJobCoordinator';
import { PreviewStore } from '../../../src/main/video-stabilization/previewStore';
import { diagnosticCandidateKey, type DiagnosticCandidate } from '../../../src/shared/videoDiagnostics';
import { IPC_CHANNELS } from '../../../src/shared/ipc';
import type { StabilizationPreviewRequest } from '../../../src/shared/videoStabilization';

function sender() {
  const listeners = new Map<string, () => void>();
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn((name: string, listener: () => void) => listeners.set(name, listener)),
    removeListener: vi.fn((name: string) => listeners.delete(name)),
    emitDestroyed: () => listeners.get('destroyed')?.(),
  };
}

const candidate: DiagnosticCandidate = {
  type: 'motion-jitter', startMs: 1_000, endMs: 1_200, peakMs: 1_100,
  severity: 'medium', scoreMultiple: 2, scoreLabel: 'fixture', confidence: 'high',
};
const fingerprint: SourceFingerprint = { size: 123, mtimeMs: 456 };
const request: StabilizationPreviewRequest = {
  sourcePath: 'C:\\video.mp4',
  candidateKey: diagnosticCandidateKey(candidate),
  selectionMode: 'range', requestedStartMs: 0, requestedEndMs: 5_000,
  sceneBoundaryConfirmed: true, scaleMotionConfirmed: false,
  strength: 'weak', zoomPercent: 2, encoder: 'libx264', includeAudio: true,
};

describe('registerVideoStabilizationIpc', () => {
  let sessions: DiagnosticSessionStore;
  let previewStore: PreviewStore;
  let createPreview: MockedFunction<CreateStabilizationPreview>;
  let fingerprintSource: MockedFunction<(path: string) => Promise<SourceFingerprint>>;
  let removeDirectory: MockedFunction<(path: string) => Promise<void>>;

  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    sessions = new DiagnosticSessionStore();
    removeDirectory = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
    previewStore = new PreviewStore({ removeDirectory, createId: () => 'preview-id' });
    createPreview = vi.fn<CreateStabilizationPreview>().mockImplementation(async (_request, _session, options) => {
      options.onProgress({ stage: 'detecting', percent: 25, processedFrames: 25, totalFrames: 100 });
      return {
        directory: 'C:\\Temp\\combark-stabilization-preview-job',
        path: 'C:\\Temp\\combark-stabilization-preview-job\\final.mp4',
        result: {
          sourceStartMs: 0, sourceEndMs: 6_000, durationMs: 6_000,
          videoFrameCount: 180, hasAudio: true, encoderUsed: 'libx264',
          boundaryAssessment: { status: 'safe', metrics: [], messages: [] }, warnings: [],
          manifest: {
            sourcePath: request.sourcePath, sourceFileName: 'video.mp4',
            candidateKey: request.candidateKey, candidateType: candidate.type,
            candidatePeakMs: candidate.peakMs, fps: 30,
            previewStartFrame: 0, previewEndFrameExclusive: 180,
            correctionStartFrame: 15, correctionEndFrameExclusive: 165,
            strength: request.strength, requestedZoomPercent: request.zoomPercent,
            appliedZoomPercent: request.zoomPercent, encoder: request.encoder,
            selectionMode: request.selectionMode,
          },
        },
      };
    });
    fingerprintSource = vi.fn<(path: string) => Promise<SourceFingerprint>>().mockResolvedValue(fingerprint);
  });

  function register(owner: ReturnType<typeof sender>) {
    sessions.retain(owner, {
      sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready',
      metadata: { durationMs: 10_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
    }, { candidates: [candidate], uncertainties: [], notices: [] }, fingerprint);
    registerVideoStabilizationIpc({
      coordinator: new MediaJobCoordinator(), sessions, previewStore,
      fingerprintSource, createPreview,
    });
  }

  it('creates and registers a main-owned preview while forwarding progress', async () => {
    const owner = sender();
    register(owner);
    await expect(mocks.handlers.get(IPC_CHANNELS.videoStabilizationCreate)?.(
      { sender: owner }, request,
    )).resolves.toMatchObject({ previewId: 'preview-id', previewPath: expect.stringContaining('final.mp4') });
    expect(owner.send).toHaveBeenCalledWith(
      IPC_CHANNELS.videoStabilizationProgress,
      expect.objectContaining({ stage: 'detecting', percent: 25 }),
    );
  });

  it('rejects stale source fingerprints and candidates absent from the retained result', async () => {
    const owner = sender();
    register(owner);
    fingerprintSource.mockResolvedValueOnce({ size: 999, mtimeMs: 456 });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoStabilizationCreate)?.(
      { sender: owner }, request,
    )).rejects.toThrow('변경');
    fingerprintSource.mockResolvedValueOnce(fingerprint);
    await expect(mocks.handlers.get(IPC_CHANNELS.videoStabilizationCreate)?.(
      { sender: owner }, { ...request, candidateKey: 'motion-jump:1:2:1' },
    )).rejects.toThrow('후보');
    expect(createPreview).not.toHaveBeenCalled();
  });

  it('keeps cancellation owner-only and releases the coordinator after abort', async () => {
    const owner = sender();
    const foreign = sender();
    register(owner);
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    createPreview.mockImplementationOnce(async (_request, _session, options) => {
      signal = options.signal;
      await new Promise<void>((resolve) => { finish = resolve; });
      if (signal?.aborted) { const error = new Error('canceled'); error.name = 'AbortError'; throw error; }
      throw new Error('unexpected');
    });
    const pending = mocks.handlers.get(IPC_CHANNELS.videoStabilizationCreate)?.({ sender: owner }, request);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await mocks.handlers.get(IPC_CHANNELS.videoStabilizationCancel)?.({ sender: foreign });
    expect(signal?.aborted).toBe(false);
    await mocks.handlers.get(IPC_CHANNELS.videoStabilizationCancel)?.({ sender: owner });
    expect(signal?.aborted).toBe(true);
    finish?.();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('disposes only an owner-issued preview id and cleans on renderer destruction', async () => {
    const owner = sender();
    register(owner);
    await mocks.handlers.get(IPC_CHANNELS.videoStabilizationCreate)?.({ sender: owner }, request);
    await expect(mocks.handlers.get(IPC_CHANNELS.videoStabilizationDispose)?.(
      { sender: sender() }, 'preview-id',
    )).resolves.toBe(false);
    owner.emitDestroyed();
    await vi.waitFor(() => expect(removeDirectory).toHaveBeenCalledWith(
      'C:\\Temp\\combark-stabilization-preview-job',
    ));
  });
});

describe('createFfmpegStabilizationPreview', () => {
  it('runs exact-frame detect, transform, verification, then finalizes the preview', async () => {
    const jobCandidate = { ...candidate, startMs: 3_000, endMs: 3_200, peakMs: 3_100 };
    const session: RetainedDiagnosticSession = {
      selected: {
        sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready' as const,
        metadata: { durationMs: 10_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
      },
      result: { candidates: [jobCandidate], uncertainties: [], notices: [] },
      fingerprint,
    };
    const runProcess = vi.fn().mockResolvedValue({
      code: 0, stdout: '', stderr: '[Parsed_vfrdet_0] VFR:0.000000 (0/179)',
    });
    const renameFile = vi.fn().mockResolvedValue(undefined);
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const result = await createFfmpegStabilizationPreview({
      ...request,
      candidateKey: diagnosticCandidateKey(jobCandidate),
      requestedStartMs: 2_000,
      requestedEndMs: 7_000,
    }, session, { signal: new AbortController().signal, onProgress }, {
      ffmpegPath: 'ffmpeg',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-stabilization-preview-job'),
      readTextFile: vi.fn().mockResolvedValue(
        `VID.STAB 1\n${Array.from({ length: 180 }, (_, index) => `Frame ${index} (List 0 [])`).join('\n')}`,
      ),
      renameFile,
      removeDirectory,
      runProcess,
      verifyOutput: vi.fn().mockResolvedValue({
        metadata: { hasVideo: true, hasAudio: true, width: 1_080, height: 1_920, fps: 30, videoFrameCount: 180, videoDurationMs: 6_000, audioDurationMs: 6_000 },
        boundaryAssessment: { status: 'safe', metrics: [], messages: [] },
      }),
    });
    expect(runProcess).toHaveBeenCalledTimes(3);
    expect(runProcess.mock.calls[0][1]).not.toContain('-ss');
    expect(runProcess.mock.calls[1][1]).toContain('pipe:1');
    expect(runProcess.mock.calls[2][1]).toContain('C:\\Temp\\combark-stabilization-preview-job\\pending.mp4');
    expect(renameFile).toHaveBeenCalledWith(
      'C:\\Temp\\combark-stabilization-preview-job\\pending.mp4',
      'C:\\Temp\\combark-stabilization-preview-job\\final.mp4',
    );
    expect(result.path).toMatch(/final\.mp4$/);
    expect(result.result.manifest).toEqual({
      sourcePath: 'C:\\video.mp4',
      sourceFileName: 'video.mp4',
      candidateKey: diagnosticCandidateKey(jobCandidate),
      candidateType: 'motion-jitter',
      candidatePeakMs: 3_100,
      fps: 30,
      previewStartFrame: 45,
      previewEndFrameExclusive: 225,
      correctionStartFrame: 60,
      correctionEndFrameExclusive: 210,
      strength: 'weak',
      requestedZoomPercent: 2,
      appliedZoomPercent: 2,
      encoder: 'libx264',
      selectionMode: 'range',
    });
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'complete', percent: 100 }));
  });

  it('records zero applied zoom when stabilization is off', async () => {
    const jobCandidate = { ...candidate, startMs: 3_000, endMs: 3_200, peakMs: 3_100 };
    const result = await createFfmpegStabilizationPreview({
      ...request,
      candidateKey: diagnosticCandidateKey(jobCandidate),
      requestedStartMs: 2_000,
      requestedEndMs: 7_000,
      strength: 'off',
      zoomPercent: 3,
    }, {
      selected: {
        sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready',
        metadata: { durationMs: 10_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
      },
      result: { candidates: [jobCandidate], uncertainties: [], notices: [] }, fingerprint,
    }, { signal: new AbortController().signal, onProgress: vi.fn() }, {
      ffmpegPath: 'ffmpeg',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-stabilization-preview-off'),
      readTextFile: vi.fn(),
      renameFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
      runProcess: vi.fn().mockResolvedValue({
        code: 0, stdout: '', stderr: '[Parsed_vfrdet_0] VFR:0.000000 (0/179)',
      }),
      verifyOutput: vi.fn().mockResolvedValue({
        metadata: { hasVideo: true, hasAudio: true, width: 1_080, height: 1_920, fps: 30, videoFrameCount: 180, videoDurationMs: 6_000, audioDurationMs: 6_000 },
        boundaryAssessment: { status: 'safe', metrics: [], messages: [] },
      }),
    });
    expect(result.result.manifest.appliedZoomPercent).toBe(0);
    expect(result.result.manifest.requestedZoomPercent).toBe(3);
  });

  it('cleans the owned temp directory when FFmpeg fails', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const jobCandidate = { ...candidate, startMs: 3_000, endMs: 3_200, peakMs: 3_100 };
    await expect(createFfmpegStabilizationPreview({
      ...request,
      candidateKey: diagnosticCandidateKey(jobCandidate),
      requestedStartMs: 2_000,
      requestedEndMs: 7_000,
    }, {
      selected: {
        sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready',
        metadata: { durationMs: 10_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
      },
      result: { candidates: [jobCandidate], uncertainties: [], notices: [] }, fingerprint,
    }, { signal: new AbortController().signal, onProgress: vi.fn() }, {
      ffmpegPath: 'ffmpeg',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-stabilization-preview-failed'),
      readTextFile: vi.fn(), renameFile: vi.fn(), removeDirectory,
      runProcess: vi.fn().mockRejectedValue(new Error('ffmpeg failed')),
      verifyOutput: vi.fn(),
    })).rejects.toThrow('ffmpeg failed');
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\combark-stabilization-preview-failed');
  });
});
