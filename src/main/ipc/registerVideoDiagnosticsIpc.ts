import { win32 } from 'node:path';

import { app, dialog, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  SelectedDiagnosticVideo,
  VideoDiagnosticProgress,
  VideoMetadata,
} from '../../shared/videoDiagnostics';
import { getRuntimeFfmpegPath } from '../export/exportProject';
import {
  analyzeDiagnosticVideo,
  probeDiagnosticVideo,
} from '../video-diagnostics/analyzeVideo';

const EMPTY_METADATA: VideoMetadata = {
  durationMs: null,
  width: null,
  height: null,
  fps: null,
  hasVideo: null,
  hasAudio: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : '영상 정보를 확인하지 못했습니다.';
}

function probeStatus(metadata: VideoMetadata): 'ready' | 'partial' {
  return Object.values(metadata).every((value) => value !== null)
    ? 'ready'
    : 'partial';
}

export function registerVideoDiagnosticsIpc(): void {
  const selectedBySender = new WeakMap<Electron.WebContents, SelectedDiagnosticVideo>();
  let activeJob: { sender: Electron.WebContents; controller: AbortController } | null = null;

  ipcMain.removeHandler(IPC_CHANNELS.videoDiagnosticsSelect);
  ipcMain.handle(IPC_CHANNELS.videoDiagnosticsSelect, async (event): Promise<SelectedDiagnosticVideo | null> => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'MP4 동영상', extensions: ['mp4'] }],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    const sourcePath = selection.filePaths[0];
    if (!win32.isAbsolute(sourcePath) || !/\.mp4$/i.test(sourcePath)) {
      throw new Error('유효한 MP4 파일을 선택해야 합니다.');
    }
    let selected: SelectedDiagnosticVideo;
    try {
      const metadata = await probeDiagnosticVideo(sourcePath, {
        ffmpegPath: getRuntimeFfmpegPath(app.isPackaged, process.resourcesPath),
      });
      selected = {
        sourcePath,
        fileName: win32.basename(sourcePath),
        metadata,
        probeStatus: probeStatus(metadata),
      };
    } catch (error) {
      selected = {
        sourcePath,
        fileName: win32.basename(sourcePath),
        metadata: { ...EMPTY_METADATA },
        probeStatus: 'failed',
        probeMessage: errorMessage(error),
      };
    }
    selectedBySender.set(event.sender, selected);
    return selected;
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoDiagnosticsCancel);
  ipcMain.handle(IPC_CHANNELS.videoDiagnosticsCancel, (event): void => {
    if (activeJob?.sender === event.sender) activeJob.controller.abort();
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoDiagnosticsAnalyze);
  ipcMain.handle(IPC_CHANNELS.videoDiagnosticsAnalyze, async (event, sourcePath: unknown) => {
    const selected = selectedBySender.get(event.sender);
    if (typeof sourcePath !== 'string' || !selected || selected.sourcePath !== sourcePath) {
      throw new Error('현재 창에서 선택한 MP4 파일만 진단할 수 있습니다.');
    }
    if (selected.probeStatus === 'failed' || selected.metadata.hasVideo !== true) {
      throw new Error('영상 정보를 확인한 MP4 파일만 진단할 수 있습니다.');
    }
    if (activeJob) throw new Error('다른 영상 진단이 이미 진행 중입니다.');

    const controller = new AbortController();
    const handleDestroyed = (): void => controller.abort();
    activeJob = { sender: event.sender, controller };
    event.sender.once('destroyed', handleDestroyed);
    try {
      return await analyzeDiagnosticVideo(sourcePath, {
        ffmpegPath: getRuntimeFfmpegPath(app.isPackaged, process.resourcesPath),
        onProgress: (progress: VideoDiagnosticProgress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.videoDiagnosticsProgress, progress);
          }
        },
      }, controller.signal);
    } finally {
      event.sender.removeListener('destroyed', handleDestroyed);
      activeJob = null;
    }
  });
}
