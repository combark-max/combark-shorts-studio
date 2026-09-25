import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, on, removeListener, send } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on,
    removeListener,
    send,
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc';
import { desktopApi } from '../../src/preload/api';

describe('desktopApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes only the approved desktop API methods', async () => {
    invoke.mockResolvedValue('1.0.0');

    expect(Object.keys(desktopApi)).toEqual([
      'getAppVersion',
      'exportMp4',
      'onExportProgress',
      'openMediaDialog',
      'openNarrationDialog',
      'checkProjectSources',
      'relinkSourceFile',
      'openProjectDialog',
      'saveProjectDialog',
      'readProject',
      'writeProject',
      'writeRecovery',
      'deleteRecovery',
      'listRecoveries',
      'listRecentProjects',
      'openRecentProject',
      'removeRecentProject',
      'confirmUnsavedChanges',
      'onWindowCloseRequested',
      'respondToWindowClose',
    ]);

    expect(Object.keys(desktopApi)).not.toContain('recordRecentProject');

    await expect(desktopApi.getAppVersion()).resolves.toBe('1.0.0');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetVersion);
  });

  it('subscribes to export progress and removes the exact listener', () => {
    const listener = vi.fn();
    const cleanup = desktopApi.onExportProgress(listener);
    const registeredListener = on.mock.calls[0][1];

    registeredListener({}, { stage: 'scene', sceneIndex: 2, sceneCount: 5 });
    expect(listener).toHaveBeenCalledWith({
      stage: 'scene',
      sceneIndex: 2,
      sceneCount: 5,
    });

    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.exportProgress,
      registeredListener,
    );
  });

  it('invokes the source check and relink channels', async () => {
    const request = {
      media: [{ id: 'photo-id', sourcePath: 'C:\\media\\photo.jpg' }],
      narrationSourcePath: 'C:\\audio\\voice.mp3',
    };
    invoke
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: false })
      .mockResolvedValueOnce({
        sourcePath: 'C:\\new\\photo.png',
        fileName: 'photo.png',
      });

    await expect(desktopApi.checkProjectSources(request)).resolves.toEqual({
      missingMediaIds: [],
      narrationMissing: false,
    });
    await expect(
      desktopApi.relinkSourceFile('image', 'C:\\media\\photo.jpg'),
    ).resolves.toEqual({
      sourcePath: 'C:\\new\\photo.png',
      fileName: 'photo.png',
    });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.projectSourceCheck,
      request,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.sourceRelinkDialog,
      'image',
      'C:\\media\\photo.jpg',
    );
  });

  it('invokes the native unsaved-changes confirmation with its action', async () => {
    invoke.mockResolvedValue('discard');

    await expect(desktopApi.confirmUnsavedChanges('close')).resolves.toBe(
      'discard',
    );
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.projectConfirmUnsavedChanges,
      'close',
    );
  });

  it('subscribes to close requests, cleans up, and sends the decision', () => {
    const listener = vi.fn();
    const cleanup = desktopApi.onWindowCloseRequested(listener);
    const registeredListener = on.mock.calls[0][1];

    registeredListener({});
    expect(listener).toHaveBeenCalledOnce();

    desktopApi.respondToWindowClose(true);
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseResponse,
      true,
    );

    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseRequested,
      registeredListener,
    );
  });
});
