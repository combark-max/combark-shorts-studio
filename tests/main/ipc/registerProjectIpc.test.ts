import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\user-data'),
  },
  dialog: {
    showOpenDialog,
    showSaveDialog: vi.fn(),
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
    showOpenDialog.mockReset();
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
});
