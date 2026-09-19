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
    const recoveryCandidate = {
      projectId: project.projectId,
      name: project.name,
      modifiedAt: '2026-09-19T01:02:03.000Z',
      project,
    };
    const recentProject = {
      filePath: 'C:\\projects\\opened.cssproj',
      projectId: project.projectId,
      name: project.name,
      lastUsedAt: '2026-09-19T03:00:00.000Z',
    };
    invoke
      .mockResolvedValueOnce('1.0.0')
      .mockResolvedValueOnce('C:\\projects\\opened.cssproj')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([recoveryCandidate])
      .mockResolvedValueOnce([recentProject])
      .mockResolvedValueOnce({
        status: 'opened',
        project,
        filePath: recentProject.filePath,
      });

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
    await expect(desktopApi.writeRecovery(project)).resolves.toBeUndefined();
    await expect(
      desktopApi.deleteRecovery(project.projectId),
    ).resolves.toBeUndefined();
    await expect(desktopApi.listRecoveries()).resolves.toEqual([
      recoveryCandidate,
    ]);
    await expect(desktopApi.listRecentProjects()).resolves.toEqual([
      recentProject,
    ]);
    await expect(
      desktopApi.openRecentProject(recentProject.filePath),
    ).resolves.toEqual({
      status: 'opened',
      project,
      filePath: recentProject.filePath,
    });

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
    expect(invoke).toHaveBeenNthCalledWith(
      6,
      IPC_CHANNELS.projectRecoveryWrite,
      project,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      7,
      IPC_CHANNELS.projectRecoveryDelete,
      project.projectId,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      8,
      IPC_CHANNELS.projectRecoveryList,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      9,
      IPC_CHANNELS.projectRecentList,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      10,
      IPC_CHANNELS.projectRecentOpen,
      recentProject.filePath,
    );
  });
});
