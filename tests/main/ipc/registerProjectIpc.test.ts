import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, showMessageBox, showOpenDialog, windowFromSender } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  windowFromSender: vi.fn(),
}));

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
