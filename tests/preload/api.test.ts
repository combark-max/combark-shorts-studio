import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc';
import { desktopApi } from '../../src/preload/api';

describe('desktopApi', () => {
  it('exposes only the approved desktop API methods', async () => {
    invoke.mockResolvedValue('1.0.0');

    expect(Object.keys(desktopApi)).toEqual([
      'getAppVersion',
      'openProjectDialog',
      'saveProjectDialog',
      'readProject',
      'writeProject',
      'writeRecovery',
      'deleteRecovery',
      'listRecoveries',
      'listRecentProjects',
      'openRecentProject',
    ]);

    expect(Object.keys(desktopApi)).not.toContain('recordRecentProject');

    await expect(desktopApi.getAppVersion()).resolves.toBe('1.0.0');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetVersion);
  });
});
