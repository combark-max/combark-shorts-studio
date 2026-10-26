import { app, dialog, ipcMain } from 'electron';

import type { ExportMp4Result, ExportProgress } from '../../shared/export';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProjectDocument } from '../../shared/project/types';
import {
  exportProject,
  getMalgunGothicPath,
  getRuntimeFfmpegPath,
} from '../export/exportProject';
import { MediaJobCoordinator } from '../media-jobs/mediaJobCoordinator';

function ensureMp4Extension(filePath: string): string {
  return filePath.toLocaleLowerCase('en-US').endsWith('.mp4')
    ? filePath
    : `${filePath}.mp4`;
}

export function registerExportIpc(
  coordinator = new MediaJobCoordinator(),
): void {
  let exportInProgress = false;

  ipcMain.removeHandler(IPC_CHANNELS.exportMp4);
  ipcMain.handle(
    IPC_CHANNELS.exportMp4,
    async (event, project: ProjectDocument): Promise<ExportMp4Result> => {
      if (exportInProgress) {
        throw new Error('MP4 내보내기가 이미 진행 중입니다.');
      }

      const controller = new AbortController();
      const sender = event.sender as Electron.WebContents | undefined;
      const handleDestroyed = (): void => controller.abort();
      const lease = coordinator.tryAcquire('export', sender ?? event, () => controller.abort());
      exportInProgress = true;
      sender?.once?.('destroyed', handleDestroyed);
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
            if (!sender?.isDestroyed()) {
              sender?.send(IPC_CHANNELS.exportProgress, progress);
            }
          },
        }, controller.signal);
        return { status: 'success', filePath };
      } finally {
        sender?.removeListener?.('destroyed', handleDestroyed);
        lease.release();
        exportInProgress = false;
      }
    },
  );
}
