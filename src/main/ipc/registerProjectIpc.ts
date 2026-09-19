import { app, dialog, ipcMain } from 'electron';

import { readProjectFile, writeProjectFileAtomic } from '../project/projectStorage';
import {
  deleteRecoveryFile,
  listRecoveryFiles,
  writeRecoveryFile,
} from '../project/recoveryStorage';
import {
  listRecentProjects,
  openRecentProjectFile,
  recordRecentProject,
} from '../project/recentProjectStorage';
import { ensureProjectExtension } from '../../shared/project/path';
import type { ProjectDocumentV1 } from '../../shared/project/types';
import { IPC_CHANNELS } from '../../shared/ipc';

const projectFileFilter = {
  name: 'Combark Shorts Studio 프로젝트',
  extensions: ['cssproj'],
};

export function registerProjectIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.projectOpenDialog);
  ipcMain.handle(IPC_CHANNELS.projectOpenDialog, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [projectFileFilter],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.removeHandler(IPC_CHANNELS.projectSaveDialog);
  ipcMain.handle(
    IPC_CHANNELS.projectSaveDialog,
    async (_event, suggestedName: string) => {
      const result = await dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [projectFileFilter],
      });

      return result.canceled || !result.filePath
        ? null
        : ensureProjectExtension(result.filePath);
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRead);
  ipcMain.handle(
    IPC_CHANNELS.projectRead,
    async (_event, filePath: string) => {
      const project = await readProjectFile(filePath);

      try {
        await recordRecentProject(app.getPath('userData'), filePath, project);
      } catch {
        // Recent-project bookkeeping must not fail a successful project open.
      }

      return project;
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectWrite);
  ipcMain.handle(
    IPC_CHANNELS.projectWrite,
    async (_event, filePath: string, project: ProjectDocumentV1) => {
      await writeProjectFileAtomic(filePath, project);

      try {
        await recordRecentProject(app.getPath('userData'), filePath, project);
      } catch {
        // Recent-project bookkeeping must not fail a successful project save.
      }
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRecoveryWrite);
  ipcMain.handle(
    IPC_CHANNELS.projectRecoveryWrite,
    (_event, project: ProjectDocumentV1) =>
      writeRecoveryFile(app.getPath('userData'), project),
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRecoveryDelete);
  ipcMain.handle(
    IPC_CHANNELS.projectRecoveryDelete,
    (_event, projectId: string) =>
      deleteRecoveryFile(app.getPath('userData'), projectId),
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRecoveryList);
  ipcMain.handle(IPC_CHANNELS.projectRecoveryList, () =>
    listRecoveryFiles(app.getPath('userData')),
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRecentList);
  ipcMain.handle(IPC_CHANNELS.projectRecentList, () =>
    listRecentProjects(app.getPath('userData')),
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectRecentOpen);
  ipcMain.handle(IPC_CHANNELS.projectRecentOpen, (_event, filePath: string) =>
    openRecentProjectFile(app.getPath('userData'), filePath),
  );
}
