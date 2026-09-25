import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, showMessageBox, showOpenDialog, stat, windowFromSender } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  stat: vi.fn(),
  windowFromSender: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: { ...actual, stat },
    stat,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\user-data'),
  },
  dialog: {
    showMessageBox,
    showOpenDialog,
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: windowFromSender,
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerProjectIpc } from '../../../src/main/ipc/registerProjectIpc';
import { IPC_CHANNELS } from '../../../src/shared/ipc';

describe('registerProjectIpc media import', () => {
  beforeEach(() => {
    handlers.clear();
    showMessageBox.mockReset();
    showOpenDialog.mockReset();
    stat.mockReset();
    stat.mockResolvedValue({ isFile: () => true });
    windowFromSender.mockReset();
    registerProjectIpc();
  });

  it('returns supported selected files as media assets', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [
        'C:\\media\\PHOTO.JPG',
        'C:\\media\\clip.mp4',
        'C:\\media\\notes.txt',
      ],
    });
    const handler = handlers.get(IPC_CHANNELS.mediaOpenDialog);

    const result = await handler?.({});

    expect(result).toEqual([
      {
        id: expect.any(String),
        kind: 'image',
        sourcePath: 'C:\\media\\PHOTO.JPG',
        fileName: 'PHOTO.JPG',
      },
      {
        id: expect.any(String),
        kind: 'video',
        sourcePath: 'C:\\media\\clip.mp4',
        fileName: 'clip.mp4',
      },
    ]);
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '사진 및 영상',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4'],
        },
      ],
    });
  });

  it('returns an empty list when media selection is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = handlers.get(IPC_CHANNELS.mediaOpenDialog);

    await expect(handler?.({})).resolves.toEqual([]);
  });

  it.each([
    ['C:\\audio\\voice.mp3', 'voice.mp3'],
    ['C:\\audio\\VOICE.WAV', 'VOICE.WAV'],
  ])('returns one supported narration file: %s', async (sourcePath, fileName) => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [sourcePath],
    });
    const handler = handlers.get(IPC_CHANNELS.narrationOpenDialog);

    await expect(handler?.({})).resolves.toEqual({ sourcePath, fileName });
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: '내레이션', extensions: ['mp3', 'wav'] }],
    });
  });

  it('returns null when narration selection is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = handlers.get(IPC_CHANNELS.narrationOpenDialog);

    await expect(handler?.({})).resolves.toBeNull();
  });

  it('reports missing media and narration without failing on one filesystem error', async () => {
    stat.mockImplementation(async (filePath: string) => {
      if (filePath.includes('denied')) {
        throw new Error('unavailable');
      }
      return { isFile: () => !filePath.includes('missing') };
    });
    const handler = handlers.get(IPC_CHANNELS.projectSourceCheck);

    expect(handler).toBeTypeOf('function');
    const result = await handler?.({}, {
        media: [
          { id: 'present-id', sourcePath: 'C:\\media\\present.jpg' },
          { id: 'missing-id', sourcePath: 'C:\\media\\missing.mp4' },
          { id: 'denied-id', sourcePath: 'C:\\media\\denied.png' },
        ],
        narrationSourcePath: 'C:\\audio\\missing.wav',
      });
    expect(stat.mock.calls).toEqual([
      ['C:\\media\\present.jpg'],
      ['C:\\media\\missing.mp4'],
      ['C:\\media\\denied.png'],
      ['C:\\audio\\missing.wav'],
    ]);
    await expect(stat.mock.results[0].value).resolves.toEqual({
      isFile: expect.any(Function),
    });
    expect(result).toEqual({
      missingMediaIds: ['missing-id', 'denied-id'],
      narrationMissing: true,
    });
  });

  it('reports present media and narration sources as available', async () => {
    const handler = handlers.get(IPC_CHANNELS.projectSourceCheck);

    expect(handler).toBeTypeOf('function');
    await expect(
      handler?.({}, {
        media: [
          { id: 'image-id', sourcePath: 'C:\\media\\photo.jpg' },
          { id: 'video-id', sourcePath: 'C:\\media\\clip.mp4' },
        ],
        narrationSourcePath: 'C:\\audio\\voice.mp3',
      }),
    ).resolves.toEqual({
      missingMediaIds: [],
      narrationMissing: false,
    });
  });

  it.each([
    ['image', 'C:\\old\\photo.jpg', 'C:\\new\\PHOTO.PNG', { name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    ['video', 'C:\\old\\clip.mp4', 'C:\\new\\renamed.mp4', { name: '영상', extensions: ['mp4'] }],
    ['narration', 'C:\\old\\voice.mp3', 'C:\\new\\renamed.wav', { name: '내레이션', extensions: ['mp3', 'wav'] }],
  ] as const)(
    'selects one validated %s replacement',
    async (kind, previousPath, sourcePath, filter) => {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourcePath] });
      const handler = handlers.get(IPC_CHANNELS.sourceRelinkDialog);

      expect(handler).toBeTypeOf('function');
      await expect(handler?.({}, kind, previousPath)).resolves.toEqual({
        sourcePath,
        fileName: sourcePath.split('\\').at(-1),
      });
      expect(showOpenDialog).toHaveBeenCalledWith({
        defaultPath: previousPath,
        properties: ['openFile'],
        filters: [filter],
      });
    },
  );

  it('rejects a selected source whose kind does not match the requested kind', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\new\\wrong.mp4'],
    });
    const handler = handlers.get(IPC_CHANNELS.sourceRelinkDialog);

    expect(handler).toBeTypeOf('function');
    await expect(
      handler?.({}, 'image', 'C:\\old\\photo.jpg'),
    ).resolves.toBeNull();
  });

  it('returns null when source relink is canceled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = handlers.get(IPC_CHANNELS.sourceRelinkDialog);

    expect(handler).toBeTypeOf('function');
    await expect(
      handler?.({}, 'video', 'C:\\old\\clip.mp4'),
    ).resolves.toBeNull();
  });

  it.each([
    [0, 'save'],
    [1, 'discard'],
    [2, 'cancel'],
  ] as const)(
    'maps native confirmation response %s to %s',
    async (response, expectedChoice) => {
      const sender = {};
      const parentWindow = {};
      windowFromSender.mockReturnValue(parentWindow);
      showMessageBox.mockResolvedValue({ response });
      const handler = handlers.get(
        IPC_CHANNELS.projectConfirmUnsavedChanges,
      );

      await expect(handler?.({ sender }, 'new')).resolves.toBe(expectedChoice);
      expect(showMessageBox).toHaveBeenCalledWith(
        parentWindow,
        expect.objectContaining({
          buttons: ['저장하고 계속', '저장하지 않고 계속', '취소'],
          cancelId: 2,
          defaultId: 0,
        }),
      );
    },
  );

  it('uses close-specific labels and rejects an invalid action', async () => {
    const sender = {};
    windowFromSender.mockReturnValue({});
    showMessageBox.mockResolvedValue({ response: 2 });
    const handler = handlers.get(IPC_CHANNELS.projectConfirmUnsavedChanges);

    await expect(handler?.({ sender }, 'close')).resolves.toBe('cancel');
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        buttons: ['저장하고 종료', '저장하지 않고 종료', '취소'],
      }),
    );
    await expect(handler?.({ sender }, 'invalid')).resolves.toBe('cancel');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });
});
