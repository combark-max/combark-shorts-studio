import { app, dialog, ipcMain } from 'electron';

import type { ExportMp4Result, ExportProgress } from '../../shared/export';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProjectDocument } from '../../shared/project/types';
import {
  exportProject,
  getMalgunGothicPath,
  getRuntimeFfmpegPath,
} from '../export/exportProject';

function ensureMp4Extension(filePath: string): string {
  return filePath.toLocaleLowerCase('en-US').endsWith('.mp4')
    ? filePath
    : `${filePath}.mp4`;
}

export function registerExportIpc(): void {
  let exportInProgress = false;

  ipcMain.removeHandler(IPC_CHANNELS.exportMp4);
  ipcMain.handle(
    IPC_CHANNELS.exportMp4,
    async (event, project: ProjectDocument): Promise<ExportMp4Result> => {
      if (exportInProgress) {
        throw new Error('MP4 내보내기가 이미 진행 중입니다.');
      }

      exportInProgress = true;
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: `${project.name}.mp4`,
          filters: [{ name: 'MP4 비디오', extensions: ['mp4'] }],
        });
        if (result.canceled || !result.filePath) {
          return { status: 'canceled' };
        }

        const filePath = ensureMp4Extension(result.filePath);
        await exportProject(project, filePath, {
          ffmpegPath: getRuntimeFfmpegPath(app.isPackaged, process.resourcesPath),
          fontPath: getMalgunGothicPath(),
          onProgress: (progress: ExportProgress) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.exportProgress, progress);
            }
          },
        });
        return { status: 'success', filePath };
      } finally {
        exportInProgress = false;
      }
    },
  );
}
