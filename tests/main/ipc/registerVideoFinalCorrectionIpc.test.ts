import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler)),
  },
}));

import { registerVideoFinalCorrectionIpc } from '../../../src/main/ipc/registerVideoFinalCorrectionIpc';
import { MediaJobCoordinator } from '../../../src/main/media-jobs/mediaJobCoordinator';
import { IPC_CHANNELS } from '../../../src/shared/ipc';
import type { VideoFinalCorrectionResult } from '../../../src/shared/videoFinalCorrection';

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
  durationMs: 12_000, width: 1_080, height: 1_920, fps: 30,
  hasVideo: true, hasAudio: true,
};

const result: VideoFinalCorrectionResult = {
  sourcePath: 'C:\\media\\source.mp4',
  outputPath: 'C:\\media\\source-corrected.mp4',
  method: 'basic', width: 1_080, height: 1_920, fps: 30,
  frameCount: 360, durationMs: 12_000, audioStreamCount: 1,
};

describe('registerVideoFinalCorrectionIpc', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\media\\source.mp4'],
    });
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\media\\source-corrected.mp4',
    });
  });

  it('owns the selected source and a distinct non-existing output per renderer', async () => {
    const owner = sender();
    registerVideoFinalCorrectionIpc({
      coordinator: new MediaJobCoordinator(),
      probeVideo: vi.fn().mockResolvedValue(metadata),
      pathExists: vi.fn().mockResolvedValue(false),
      fingerprintSource: vi.fn().mockResolvedValue({ size: 100, mtimeMs: 200 }),
      correctVideo: vi.fn().mockResolvedValue(result),
    });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelect)?.(
      { sender: owner },
    )).resolves.toMatchObject({
      sourcePath: result.sourcePath,
      fileName: 'source.mp4',
        capabilities: { basic: true, strong: true },
    });
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelectOutput)?.(
      { sender: owner }, result.sourcePath,
    )).resolves.toBe(result.outputPath);
  });

  it('rejects arbitrary renderer paths and existing output, while accepting verified strong', async () => {
    const owner = sender();
    const pathExists = vi.fn().mockResolvedValue(false);
    const correctVideo = vi.fn().mockResolvedValue(result);
    registerVideoFinalCorrectionIpc({
      coordinator: new MediaJobCoordinator(),
      probeVideo: vi.fn().mockResolvedValue(metadata),
      pathExists,
      fingerprintSource: vi.fn().mockResolvedValue({ size: 100, mtimeMs: 200 }),
      correctVideo,
    });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelect)?.({ sender: owner });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelectOutput)?.(
      { sender: owner }, result.sourcePath,
    );
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionStart)?.(
      { sender: owner }, { ...result, sourcePath: 'C:\\other.mp4' },
    )).rejects.toThrow('선택');
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionStart)?.(
      { sender: owner }, { sourcePath: result.sourcePath, outputPath: result.outputPath, method: 'strong' },
    )).resolves.toEqual(result);
    expect(correctVideo).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'strong' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    pathExists.mockResolvedValueOnce(true);
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelectOutput)?.(
      { sender: owner }, result.sourcePath,
    )).rejects.toThrow('이미');
  });

  it('forwards progress and checks the source fingerprint immediately before publish', async () => {
    const owner = sender();
    const fingerprintSource = vi.fn()
      .mockResolvedValueOnce({ size: 100, mtimeMs: 200 })
      .mockResolvedValueOnce({ size: 100, mtimeMs: 200 });
    const correctVideo = vi.fn(async (_request, options) => {
      options.onProgress({
        stage: 'detecting', percent: 25, processedFrames: 90, totalFrames: 360,
      });
      await options.beforePublish();
      return result;
    });
    registerVideoFinalCorrectionIpc({
      coordinator: new MediaJobCoordinator(),
      probeVideo: vi.fn().mockResolvedValue(metadata),
      pathExists: vi.fn().mockResolvedValue(false),
      fingerprintSource,
      correctVideo,
    });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelect)?.({ sender: owner });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelectOutput)?.(
      { sender: owner }, result.sourcePath,
    );
    await expect(mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionStart)?.(
      { sender: owner }, { sourcePath: result.sourcePath, outputPath: result.outputPath, method: 'basic' },
    )).resolves.toEqual(result);
    expect(owner.send).toHaveBeenCalledWith(
      IPC_CHANNELS.videoFinalCorrectionProgress,
      expect.objectContaining({ stage: 'detecting', percent: 25 }),
    );
    expect(fingerprintSource).toHaveBeenCalledTimes(2);
  });

  it('cancels only the owning renderer and releases the global media lease', async () => {
    const owner = sender();
    const foreign = sender();
    const coordinator = new MediaJobCoordinator();
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const correctVideo = vi.fn(async (_request, options) => {
      signal = options.signal;
      await new Promise<void>((resolve) => { finish = resolve; });
      if (signal?.aborted) { const error = new Error('canceled'); error.name = 'AbortError'; throw error; }
      return result;
    });
    registerVideoFinalCorrectionIpc({
      coordinator,
      probeVideo: vi.fn().mockResolvedValue(metadata),
      pathExists: vi.fn().mockResolvedValue(false),
      fingerprintSource: vi.fn().mockResolvedValue({ size: 100, mtimeMs: 200 }),
      correctVideo,
    });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelect)?.({ sender: owner });
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionSelectOutput)?.(
      { sender: owner }, result.sourcePath,
    );
    const pending = mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionStart)?.(
      { sender: owner }, { sourcePath: result.sourcePath, outputPath: result.outputPath, method: 'basic' },
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await mocks.handlers.get(IPC_CHANNELS.videoFinalCorrectionCancel)?.({ sender: foreign });
    expect(signal?.aborted).toBe(false);
    owner.emitDestroyed();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(coordinator.activeJob()).toBeNull();
  });
});
