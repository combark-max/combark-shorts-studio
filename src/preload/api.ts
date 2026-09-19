import { ipcRenderer } from 'electron';

import type {
  OpenRecentProjectResult,
  ProjectDocumentV1,
  RecentProject,
  RecoveryCandidate,
} from '../shared/project/types';
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
  listRecoveries: (): Promise<RecoveryCandidate[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryList),
  listRecentProjects: (): Promise<RecentProject[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecentList),
  openRecentProject: (filePath: string): Promise<OpenRecentProjectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecentOpen, filePath),
};

export type DesktopApi = typeof desktopApi;
