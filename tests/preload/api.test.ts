import { describe, expect, it, vi } from 'vitest';

const { invoke, on, removeListener } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on,
    removeListener,
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc';
import { desktopApi } from '../../src/preload/api';

describe('desktopApi', () => {
  it('exposes only the approved desktop API methods', async () => {
    invoke.mockResolvedValue('1.0.0');

    expect(Object.keys(desktopApi)).toEqual([
      'getAppVersion',
      'exportMp4',
      'onExportProgress',
      'openMediaDialog',
      'openNarrationDialog',
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
});
