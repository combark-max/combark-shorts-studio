import { ipcRenderer, type IpcRendererEvent } from 'electron';

import type { ExportMp4Result, ExportProgress } from '../shared/export';
import type {
  MediaAsset,
  NarrationAsset,
  OpenRecentProjectResult,
  ProjectDocument,
  RecentProject,
  RecoveryCandidate,
} from '../shared/project/types';
import {
  IPC_CHANNELS,
  type UnsavedChangesAction,
  type UnsavedChangesChoice,
} from '../shared/ipc';

export const desktopApi = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  exportMp4: (project: ProjectDocument): Promise<ExportMp4Result> =>
    ipcRenderer.invoke(IPC_CHANNELS.exportMp4, project),
  onExportProgress: (
    listener: (progress: ExportProgress) => void,
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, progress: ExportProgress): void => {
      listener(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.exportProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.exportProgress, handler);
    };
  },
  openMediaDialog: (): Promise<MediaAsset[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.mediaOpenDialog),
  openNarrationDialog: (): Promise<NarrationAsset | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.narrationOpenDialog),
  openProjectDialog: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectOpenDialog),
  saveProjectDialog: (suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSaveDialog, suggestedName),
  readProject: (filePath: string): Promise<ProjectDocument> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRead, filePath),
  writeProject: (
    filePath: string,
    project: ProjectDocument,
  ): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.projectWrite, filePath, project),
  writeRecovery: (project: ProjectDocument): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryWrite, project),
  deleteRecovery: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryDelete, projectId),
  listRecoveries: (): Promise<RecoveryCandidate[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryList),
  listRecentProjects: (): Promise<RecentProject[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecentList),
  openRecentProject: (filePath: string): Promise<OpenRecentProjectResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecentOpen, filePath),
  removeRecentProject: (filePath: string): Promise<RecentProject[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRecentRemove, filePath),
  confirmUnsavedChanges: (
    action: UnsavedChangesAction,
  ): Promise<UnsavedChangesChoice> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectConfirmUnsavedChanges, action),
  onWindowCloseRequested: (listener: () => void): (() => void) => {
    const handler = (): void => {
      listener();
    };
    ipcRenderer.on(IPC_CHANNELS.windowCloseRequested, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.windowCloseRequested, handler);
    };
  },
  respondToWindowClose: (allow: boolean): void => {
    ipcRenderer.send(IPC_CHANNELS.windowCloseResponse, allow);
  },
};

export type DesktopApi = typeof desktopApi;
