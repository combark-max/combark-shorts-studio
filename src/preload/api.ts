import { ipcRenderer } from 'electron';

import type { ProjectDocumentV1 } from '../shared/project/types';
import { IPC_CHANNELS } from '../shared/ipc';

export const desktopApi = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  openProjectDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectOpenDialog),
  saveProjectDialog: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSaveDialog, suggestedName),
  readProject: (filePath: string): Promise<ProjectDocumentV1> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRead, filePath),
  writeProject: (
    filePath: string,
    project: ProjectDocumentV1,
  ): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.projectWrite, filePath, project),
  writeRecovery: (project: ProjectDocumentV1): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryWrite, project),
  deleteRecovery: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryDelete, projectId),
};

export type DesktopApi = typeof desktopApi;
