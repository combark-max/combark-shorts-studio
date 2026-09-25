import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

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
  removeRecentProject,
} from '../project/recentProjectStorage';
import { ensureProjectExtension } from '../../shared/project/path';
import {
  getMediaKind,
  isSupportedNarrationPath,
} from '../../shared/project/media';
import type {
  MediaAsset,
  NarrationAsset,
  ProjectDocument,
} from '../../shared/project/types';
import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  UnsavedChangesAction,
  UnsavedChangesChoice,
} from '../../shared/ipc';

const projectFileFilter = {
  name: 'Combark Shorts Studio 프로젝트',
  extensions: ['cssproj'],
};

const mediaFileFilter = {
  name: '사진 및 영상',
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4'],
};

const narrationFileFilter = {
  name: '내레이션',
  extensions: ['mp3', 'wav'],
};

function createMediaAsset(filePath: string): MediaAsset | null {
  const kind = getMediaKind(filePath);

  if (!kind) {
    return null;
  }

  return {
    id: randomUUID(),
    kind,
    sourcePath: filePath,
    fileName: basename(filePath),
  };
}

function createNarrationAsset(filePath: string): NarrationAsset | null {
  if (!isSupportedNarrationPath(filePath)) {
    return null;
  }

  return {
    sourcePath: filePath,
    fileName: basename(filePath),
  };
}

export function registerProjectIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.projectConfirmUnsavedChanges);
  ipcMain.handle(
    IPC_CHANNELS.projectConfirmUnsavedChanges,
    async (event, action: UnsavedChangesAction): Promise<UnsavedChangesChoice> => {
      if (!['new', 'open', 'recent', 'close'].includes(action)) {
        return 'cancel';
      }

      const isClose = action === 'close';
      const options = {
        type: 'warning' as const,
        title: 'Combark Shorts Studio',
        message: '저장하지 않은 변경 사항이 있습니다.',
        detail: isClose
          ? '종료하기 전에 변경 사항을 저장하시겠습니까?'
          : '계속하기 전에 변경 사항을 저장하시겠습니까?',
        buttons: isClose
          ? ['저장하고 종료', '저장하지 않고 종료', '취소']
          : ['저장하고 계속', '저장하지 않고 계속', '취소'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);

      return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel';
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.mediaOpenDialog);
  ipcMain.handle(IPC_CHANNELS.mediaOpenDialog, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [mediaFileFilter],
    });

    return result.canceled
      ? []
      : result.filePaths
          .map(createMediaAsset)
          .filter((asset): asset is MediaAsset => asset !== null);
  });

  ipcMain.removeHandler(IPC_CHANNELS.narrationOpenDialog);
  ipcMain.handle(IPC_CHANNELS.narrationOpenDialog, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [narrationFileFilter],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return createNarrationAsset(result.filePaths[0]);
  });

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
    async (_event, filePath: string, project: ProjectDocument) => {
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
    (_event, project: ProjectDocument) =>
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

  ipcMain.removeHandler(IPC_CHANNELS.projectRecentRemove);
  ipcMain.handle(IPC_CHANNELS.projectRecentRemove, (_event, filePath: string) =>
    removeRecentProject(app.getPath('userData'), filePath),
  );
}
