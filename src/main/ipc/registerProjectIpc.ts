import { app, dialog, ipcMain } from 'electron';

import { readProjectFile, writeProjectFileAtomic } from '../project/projectStorage';
import {
  deleteRecoveryFile,
  writeRecoveryFile,
} from '../project/recoveryStorage';
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
  ipcMain.handle(IPC_CHANNELS.projectRead, (_event, filePath: string) =>
    readProjectFile(filePath),
  );

  ipcMain.removeHandler(IPC_CHANNELS.projectWrite);
  ipcMain.handle(
    IPC_CHANNELS.projectWrite,
    (_event, filePath: string, project: ProjectDocumentV1) =>
      writeProjectFileAtomic(filePath, project),
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
}
