import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  analyzeContactSheet: vi.fn(),
  createContactSheetVideo: vi.fn(),
  getRuntimeFfmpegPath: vi.fn(() => 'C:\\tools\\ffmpeg.exe'),
  randomUUID: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  default: { randomUUID: mocks.randomUUID },
  randomUUID: mocks.randomUUID,
}));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));
vi.mock('../../../src/main/contact-sheet/analyzeContactSheet', () => ({
  analyzeContactSheet: mocks.analyzeContactSheet,
}));
vi.mock('../../../src/main/contact-sheet/createContactSheetVideo', () => ({
  createContactSheetVideo: mocks.createContactSheetVideo,
}));
vi.mock('../../../src/main/export/exportProject', () => ({
  getRuntimeFfmpegPath: mocks.getRuntimeFfmpegPath,
}));

import { registerContactSheetVideoIpc } from '../../../src/main/ipc/registerContactSheetVideoIpc';
import { IPC_CHANNELS } from '../../../src/shared/ipc';

function sender() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe('registerContactSheetVideoIpc', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerContactSheetVideoIpc();
  });

  it('selects multiple supported images in dialog order', async () => {
    mocks.randomUUID
      .mockReturnValueOnce('first-id')
      .mockReturnValueOnce('second-id');
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\images\\first.png', 'C:\\images\\second.jpeg'],
    });

    await expect(
      mocks.handlers.get(IPC_CHANNELS.contactSheetVideoOpen)?.({}),
    ).resolves.toEqual([
      {
        id: 'first-id',
        sourcePath: 'C:\\images\\first.png',
        fileName: 'first.png',
      },
      {
        id: 'second-id',
        sourcePath: 'C:\\images\\second.jpeg',
        fileName: 'second.jpeg',
      },
    ]);
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Contact sheet 이미지', extensions: ['jpg', 'jpeg', 'png'] }],
    });
  });

  it.each([
    null,
    [null],
    [{ id: 'bad', sourcePath: 'relative.png', fileName: 'relative.png' }],
    [{ id: 'bad', sourcePath: 'C:\\images\\bad.webp', fileName: 'bad.webp' }],
  ])('rejects malformed analyze IPC input without invoking nativeImage: %j', async (value) => {
    await expect(
      mocks.handlers.get(IPC_CHANNELS.contactSheetVideoAnalyze)?.({}, value),
    ).rejects.toThrow('유효하지 않은');
    expect(mocks.analyzeContactSheet).not.toHaveBeenCalled();
  });

  it('reports each sheet analysis independently without dropping failures', async () => {
    mocks.analyzeContactSheet
      .mockReturnValueOnce({ frames: Array.from({ length: 16 }) })
      .mockImplementationOnce(() => {
        throw new Error('separator missing');
      });
    const sheets = [
      { id: 'ok', sourcePath: 'C:\\images\\ok.png', fileName: 'ok.png' },
      { id: 'bad', sourcePath: 'C:\\images\\bad.png', fileName: 'bad.png' },
    ];

    await expect(
      mocks.handlers.get(IPC_CHANNELS.contactSheetVideoAnalyze)?.({}, sheets),
    ).resolves.toEqual([
      { id: 'ok', status: 'recognized', frameCount: 16 },
      { id: 'bad', status: 'failed', message: 'separator missing' },
    ]);
  });

  it('returns canceled without creating frames when output selection is canceled', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });

    await expect(
      mocks.handlers.get(IPC_CHANNELS.contactSheetVideoCreate)?.(
        { sender: sender() },
        { sheets: [{ id: 'one', sourcePath: 'C:\\images\\one.png', fileName: 'one.png' }], fps: 8 },
      ),
    ).resolves.toEqual({ status: 'canceled' });
    expect(mocks.createContactSheetVideo).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { sheets: [], fps: 8 },
    { sheets: [{ id: 'one', sourcePath: 'relative.png', fileName: 'relative.png' }], fps: 8 },
    { sheets: [{ id: 'one', sourcePath: 'C:\\images\\one.webp', fileName: 'one.webp' }], fps: 8 },
    {
      sheets: [
        { id: 'same', sourcePath: 'C:\\images\\one.png', fileName: 'one.png' },
        { id: 'same', sourcePath: 'C:\\images\\two.png', fileName: 'two.png' },
      ],
      fps: 8,
    },
    { sheets: [{ id: 'one', sourcePath: 'C:\\images\\one.png', fileName: 'one.png' }], fps: 9 },
  ])('rejects malformed create IPC input before opening save dialog: %j', async (value) => {
    await expect(
      mocks.handlers.get(IPC_CHANNELS.contactSheetVideoCreate)?.(
        { sender: sender() },
        value,
      ),
    ).rejects.toThrow('유효하지 않은');
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    expect(mocks.createContactSheetVideo).not.toHaveBeenCalled();
  });

  it('creates an mp4, forwards progress, and cancels the active job', async () => {
    const webContents = sender();
    const request = {
      sheets: [{ id: 'one', sourcePath: 'C:\\images\\one.png', fileName: 'one.png' }],
      fps: 8 as const,
    };
    let finish: (() => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\sequence',
    });
    mocks.createContactSheetVideo.mockImplementation(
      async (_request, _outputPath, dependencies, signal) => {
        capturedSignal = signal;
        dependencies.onProgress({ stage: 'encoding' });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (signal.aborted) {
          const error = new Error('canceled');
          error.name = 'AbortError';
          throw error;
        }
      },
    );

    const createPromise = mocks.handlers.get(IPC_CHANNELS.contactSheetVideoCreate)?.(
      { sender: webContents },
      request,
    );
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    await mocks.handlers.get(IPC_CHANNELS.contactSheetVideoCancel)?.(
      { sender: webContents },
    );
    expect(capturedSignal?.aborted).toBe(true);
    finish?.();

    await expect(createPromise).resolves.toEqual({ status: 'canceled' });
    expect(mocks.createContactSheetVideo).toHaveBeenCalledWith(
      request,
      'C:\\exports\\sequence.mp4',
      expect.objectContaining({ ffmpegPath: 'C:\\tools\\ffmpeg.exe' }),
      expect.any(AbortSignal),
    );
    expect(webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.contactSheetVideoProgress,
      { stage: 'encoding' },
    );
  });

  it('rejects a second contact-sheet job while one is active', async () => {
    let finish: (() => void) | undefined;
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\first.mp4',
    });
    mocks.createContactSheetVideo.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const handler = mocks.handlers.get(IPC_CHANNELS.contactSheetVideoCreate);
    const first = handler?.(
      { sender: sender() },
      { sheets: [{ id: 'one', sourcePath: 'C:\\images\\one.png', fileName: 'one.png' }], fps: 8 },
    );
    await Promise.resolve();

    await expect(handler?.(
      { sender: sender() },
      { sheets: [{ id: 'two', sourcePath: 'C:\\images\\two.png', fileName: 'two.png' }], fps: 8 },
    )).rejects.toThrow('진행 중');
    finish?.();
    await first;
  });
});
