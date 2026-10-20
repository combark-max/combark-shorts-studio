import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
  probeDiagnosticVideo: vi.fn(),
  analyzeDiagnosticVideo: vi.fn(),
  getRuntimeFfmpegPath: vi.fn(() => 'C:\\tools\\ffmpeg.exe'),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler)),
  },
}));
vi.mock('../../../src/main/video-diagnostics/analyzeVideo', () => ({
  probeDiagnosticVideo: mocks.probeDiagnosticVideo,
  analyzeDiagnosticVideo: mocks.analyzeDiagnosticVideo,
}));
vi.mock('../../../src/main/export/exportProject', () => ({
  getRuntimeFfmpegPath: mocks.getRuntimeFfmpegPath,
}));

import { registerVideoDiagnosticsIpc } from '../../../src/main/ipc/registerVideoDiagnosticsIpc';
import { IPC_CHANNELS } from '../../../src/shared/ipc';

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

const metadata = {
  durationMs: 10_000, width: 1080, height: 1920, fps: 30,
  hasVideo: true, hasAudio: true,
};

describe('registerVideoDiagnosticsIpc', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerVideoDiagnosticsIpc();
  });

  it('selects one MP4 and returns probed metadata owned by the sender', async () => {
    const webContents = sender();
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\영상\\완성.mp4'] });
    mocks.probeDiagnosticVideo.mockResolvedValue(metadata);

    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: webContents })).resolves.toEqual({
      sourcePath: 'C:\\영상\\완성.mp4',
      fileName: '완성.mp4',
      metadata,
      probeStatus: 'ready',
    });
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'MP4 동영상', extensions: ['mp4'] }],
    });
  });

  it('returns null when selection is canceled and exposes partial metadata honestly', async () => {
    const webContents = sender();
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: webContents })).resolves.toBeNull();

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\partial.mp4'] });
    mocks.probeDiagnosticVideo.mockResolvedValue({ ...metadata, durationMs: null, fps: null });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: webContents })).resolves.toMatchObject({
      probeStatus: 'partial',
      metadata: { durationMs: null, fps: null },
    });
  });

  it('returns a failed probe state for inaccessible or damaged files', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\bad.mp4'] });
    mocks.probeDiagnosticVideo.mockRejectedValue(new Error('올바르지 않거나 손상된 영상 파일입니다.'));
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: sender() })).resolves.toMatchObject({
      probeStatus: 'failed',
      probeMessage: '올바르지 않거나 손상된 영상 파일입니다.',
      metadata: { durationMs: null, hasVideo: null, hasAudio: null },
    });
  });

  it('rejects analysis unless the exact selected MP4 belongs to the sender', async () => {
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsAnalyze)?.(
      { sender: sender() }, 'C:\\unselected.mp4',
    )).rejects.toThrow('선택');
    expect(mocks.analyzeDiagnosticVideo).not.toHaveBeenCalled();
  });

  it('forwards progress, supports owner cancellation, and allows retry', async () => {
    const owner = sender();
    const foreign = sender();
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\video.mp4'] });
    mocks.probeDiagnosticVideo.mockResolvedValue(metadata);
    await mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: owner });

    let finish: (() => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    mocks.analyzeDiagnosticVideo.mockImplementationOnce(async (_path, dependencies, signal) => {
      capturedSignal = signal;
      dependencies.onProgress({ stage: 'frame-analysis', analyzedMs: 500, durationMs: 10_000, percent: 5 });
      await new Promise<void>((resolve) => { finish = resolve; });
      if (signal.aborted) {
        const error = new Error('canceled');
        error.name = 'AbortError';
        throw error;
      }
      return { candidates: [], uncertainties: [], notices: [] };
    });
    const first = mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsAnalyze)?.({ sender: owner }, 'C:\\video.mp4');
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    await mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsCancel)?.({ sender: foreign });
    expect(capturedSignal?.aborted).toBe(false);
    await mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsCancel)?.({ sender: owner });
    expect(capturedSignal?.aborted).toBe(true);
    finish?.();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(owner.send).toHaveBeenCalledWith(IPC_CHANNELS.videoDiagnosticsProgress, expect.objectContaining({ percent: 5 }));

    mocks.analyzeDiagnosticVideo.mockResolvedValueOnce({ candidates: [], uncertainties: [], notices: [] });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsAnalyze)?.({ sender: owner }, 'C:\\video.mp4')).resolves.toEqual({
      candidates: [], uncertainties: [], notices: [],
    });
  });

  it('prevents concurrent jobs and aborts when the owner is destroyed', async () => {
    const owner = sender();
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\video.mp4'] });
    mocks.probeDiagnosticVideo.mockResolvedValue(metadata);
    await mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsSelect)?.({ sender: owner });
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    mocks.analyzeDiagnosticVideo.mockImplementation(async (_path, _dependencies, value) => {
      signal = value;
      await new Promise<void>((resolve) => { finish = resolve; });
      if (value.aborted) { const error = new Error('canceled'); error.name = 'AbortError'; throw error; }
      return { candidates: [], uncertainties: [], notices: [] };
    });
    const first = mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsAnalyze)?.({ sender: owner }, 'C:\\video.mp4');
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(mocks.handlers.get(IPC_CHANNELS.videoDiagnosticsAnalyze)?.({ sender: owner }, 'C:\\video.mp4')).rejects.toThrow('진행 중');
    owner.emitDestroyed();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });
});
