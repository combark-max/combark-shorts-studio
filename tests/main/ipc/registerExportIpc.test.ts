import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, showSaveDialog, exportProject } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(),
  exportProject: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showSaveDialog },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
  },
}));

vi.mock('../../../src/main/export/exportProject', () => ({
  exportProject,
  getRuntimeFfmpegPath: vi.fn(() => 'C:\\tools\\ffmpeg.exe'),
  getMalgunGothicPath: vi.fn(() => 'C:\\Windows\\Fonts\\malgun.ttf'),
}));

import { registerExportIpc } from '../../../src/main/ipc/registerExportIpc';
import { IPC_CHANNELS } from '../../../src/shared/ipc';
import { createNewProject } from '../../../src/shared/project/createProject';

describe('registerExportIpc', () => {
  beforeEach(() => {
    handlers.clear();
    showSaveDialog.mockReset();
    exportProject.mockReset();
    registerExportIpc();
  });

  it('returns canceled without starting ffmpeg when the Save dialog is canceled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });
    const result = await handlers.get(IPC_CHANNELS.exportMp4)?.({}, createNewProject('취소'));
    expect(result).toEqual({ status: 'canceled' });
    expect(exportProject).not.toHaveBeenCalled();
  });

  it('exports to an mp4 path selected by the user', async () => {
    const project = createNewProject('완성본');
    const send = vi.fn();
    const sender = { isDestroyed: vi.fn(() => false), send };
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\완성본' });
    exportProject.mockImplementation(async (_project, _filePath, dependencies) => {
      dependencies.onProgress({ stage: 'preparing' });
      dependencies.onProgress({ stage: 'complete' });
    });
    const result = await handlers.get(IPC_CHANNELS.exportMp4)?.({ sender }, project);
    expect(exportProject).toHaveBeenCalledWith(project, 'C:\\exports\\완성본.mp4', expect.objectContaining({
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
    }));
    expect(send.mock.calls).toEqual([
      [IPC_CHANNELS.exportProgress, { stage: 'preparing' }],
      [IPC_CHANNELS.exportProgress, { stage: 'complete' }],
    ]);
    expect(result).toEqual({ status: 'success', filePath: 'C:\\exports\\완성본.mp4' });
  });

  it('does not send progress after the requesting sender is destroyed', async () => {
    const send = vi.fn();
    const sender = { isDestroyed: vi.fn(() => true), send };
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\완성본.mp4' });
    exportProject.mockImplementation(async (_project, _filePath, dependencies) => {
      dependencies.onProgress({ stage: 'preparing' });
    });

    await handlers.get(IPC_CHANNELS.exportMp4)?.(
      { sender },
      createNewProject('완성본'),
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a concurrent export before opening another dialog', async () => {
    let finish: (() => void) | undefined;
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\first.mp4' });
    exportProject.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const handler = handlers.get(IPC_CHANNELS.exportMp4);
    const first = handler?.({}, createNewProject('첫째'));
    await Promise.resolve();
    await expect(handler?.({}, createNewProject('둘째'))).rejects.toThrow('진행 중');
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    finish?.();
    await first;
  });
});
