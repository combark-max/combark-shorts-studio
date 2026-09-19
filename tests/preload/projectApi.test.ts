import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../src/shared/project/createProject';
import { IPC_CHANNELS } from '../../src/shared/ipc';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
  },
}));

import { desktopApi } from '../../src/preload/api';

describe('desktopApi project methods', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes the approved project channels and keeps app version access', async () => {
    const project = createNewProject('IPC 테스트');
    invoke
      .mockResolvedValueOnce('1.0.0')
      .mockResolvedValueOnce('C:\\projects\\opened.cssproj')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce(undefined);

    expect(Object.keys(desktopApi)).toEqual([
      'getAppVersion',
      'openProjectDialog',
      'saveProjectDialog',
      'readProject',
      'writeProject',
    ]);
    await expect(desktopApi.getAppVersion()).resolves.toBe('1.0.0');
    await expect(desktopApi.openProjectDialog()).resolves.toBe(
      'C:\\projects\\opened.cssproj',
    );
    await expect(desktopApi.saveProjectDialog('첫 프로젝트')).resolves.toBeNull();
    await expect(desktopApi.readProject('C:\\projects\\opened.cssproj')).resolves.toEqual(
      project,
    );
    await expect(
      desktopApi.writeProject('C:\\projects\\opened.cssproj', project),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.appGetVersion);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.projectOpenDialog);
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      IPC_CHANNELS.projectSaveDialog,
      '첫 프로젝트',
    );
    expect(invoke).toHaveBeenNthCalledWith(
      4,
      IPC_CHANNELS.projectRead,
      'C:\\projects\\opened.cssproj',
    );
    expect(invoke).toHaveBeenNthCalledWith(
      5,
      IPC_CHANNELS.projectWrite,
      'C:\\projects\\opened.cssproj',
      project,
    );
  });
});