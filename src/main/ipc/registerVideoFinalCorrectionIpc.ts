import { access } from 'node:fs/promises';
import { win32 } from 'node:path';

import { app, dialog, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { VideoMetadata } from '../../shared/videoDiagnostics';
import {
  parseVideoFinalCorrectionRequest,
  type SelectedFinalCorrectionVideo,
  type VideoFinalCorrectionProgress,
  type VideoFinalCorrectionRequest,
  type VideoFinalCorrectionResult,
} from '../../shared/videoFinalCorrection';
import { getRuntimeFfmpegPath } from '../export/exportProject';
import { MediaJobCoordinator, type MediaJobLease } from '../media-jobs/mediaJobCoordinator';
import { probeDiagnosticVideo } from '../video-diagnostics/analyzeVideo';
import { finalCorrectionCapabilities } from '../video-stabilization/stabilizationPresets';
import { fingerprintSource, type SourceFingerprint } from './registerVideoDiagnosticsIpc';

export interface RunFinalCorrectionOptions {
  signal: AbortSignal;
  onProgress: (progress: VideoFinalCorrectionProgress) => void;
  beforePublish: () => Promise<void>;
  sourceFrameEstimate: number;
}

export type RunFinalCorrection = (
  request: VideoFinalCorrectionRequest,
  options: RunFinalCorrectionOptions,
) => Promise<VideoFinalCorrectionResult>;

export interface RegisterVideoFinalCorrectionIpcOptions {
  coordinator: MediaJobCoordinator;
  probeVideo?: (path: string, signal?: AbortSignal) => Promise<VideoMetadata>;
  pathExists?: (path: string) => Promise<boolean>;
  fingerprintSource?: (path: string) => Promise<SourceFingerprint>;
  correctVideo: RunFinalCorrection;
}

interface SelectionSession {
  selected: SelectedFinalCorrectionVideo;
  outputPath: string | null;
}

function equalFingerprint(left: SourceFingerprint, right: SourceFingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function normalizedPath(path: string): string {
  return win32.normalize(path).toLocaleLowerCase('en-US');
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function correctedName(sourcePath: string): string {
  const extension = win32.extname(sourcePath);
  return `${win32.basename(sourcePath, extension)}-corrected.mp4`;
}

export function registerVideoFinalCorrectionIpc(
  options: RegisterVideoFinalCorrectionIpcOptions,
): void {
  const sessions = new WeakMap<Electron.WebContents, SelectionSession>();
  const pathExists = options.pathExists ?? defaultPathExists;
  const getFingerprint = options.fingerprintSource ?? fingerprintSource;
  const probeVideo = options.probeVideo ?? ((path, signal) => probeDiagnosticVideo(path, {
    ffmpegPath: getRuntimeFfmpegPath(app.isPackaged, process.resourcesPath),
  }, signal));
  let activeJob: {
    sender: Electron.WebContents;
    controller: AbortController;
    lease: MediaJobLease;
  } | null = null;

  ipcMain.removeHandler(IPC_CHANNELS.videoFinalCorrectionSelect);
  ipcMain.handle(IPC_CHANNELS.videoFinalCorrectionSelect, async (event) => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'MP4 동영상', extensions: ['mp4'] }],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    const sourcePath = selection.filePaths[0];
    if (!win32.isAbsolute(sourcePath) || !/\.mp4$/i.test(sourcePath)) {
      throw new Error('유효한 MP4 파일을 선택해야 합니다.');
    }
    const controller = new AbortController();
    const lease = options.coordinator.tryAcquire(
      'final-correction', event.sender, () => controller.abort(),
    );
    const handleDestroyed = (): void => controller.abort();
    event.sender.once('destroyed', handleDestroyed);
    try {
      const metadata = await probeVideo(sourcePath, controller.signal);
      if (metadata.hasVideo !== true || metadata.width === null || metadata.height === null ||
          metadata.fps === null || metadata.durationMs === null) {
        throw new Error('완전한 영상 정보를 가진 MP4 파일이 필요합니다.');
      }
      const selected: SelectedFinalCorrectionVideo = {
        sourcePath,
        fileName: win32.basename(sourcePath),
        metadata,
        capabilities: finalCorrectionCapabilities(),
      };
      sessions.set(event.sender, { selected, outputPath: null });
      return selected;
    } finally {
      event.sender.removeListener('destroyed', handleDestroyed);
      lease.release();
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoFinalCorrectionSelectOutput);
  ipcMain.handle(IPC_CHANNELS.videoFinalCorrectionSelectOutput, async (event, sourceValue: unknown) => {
    const session = sessions.get(event.sender);
    if (typeof sourceValue !== 'string' || !session || session.selected.sourcePath !== sourceValue) {
      throw new Error('현재 창에서 선택한 원본 영상을 먼저 선택하세요.');
    }
    const selection = await dialog.showSaveDialog({
      defaultPath: win32.join(win32.dirname(sourceValue), correctedName(sourceValue)),
      filters: [{ name: 'MP4 동영상', extensions: ['mp4'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    const outputPath = /\.mp4$/i.test(selection.filePath)
      ? selection.filePath
      : `${selection.filePath}.mp4`;
    if (!win32.isAbsolute(outputPath)) throw new Error('유효한 출력 경로를 선택해야 합니다.');
    if (normalizedPath(outputPath) === normalizedPath(sourceValue)) {
      throw new Error('원본 영상은 출력 파일로 덮어쓸 수 없습니다.');
    }
    if (await pathExists(outputPath)) {
      throw new Error('출력 파일이 이미 존재합니다. 다른 이름을 선택하세요.');
    }
    session.outputPath = outputPath;
    return outputPath;
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoFinalCorrectionCancel);
  ipcMain.handle(IPC_CHANNELS.videoFinalCorrectionCancel, (event): void => {
    if (activeJob?.sender === event.sender) activeJob.controller.abort();
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoFinalCorrectionStart);
  ipcMain.handle(IPC_CHANNELS.videoFinalCorrectionStart, async (event, value: unknown) => {
    const request = parseVideoFinalCorrectionRequest(value);
    const session = sessions.get(event.sender);
    if (!session || session.selected.sourcePath !== request.sourcePath ||
        session.outputPath !== request.outputPath) {
      throw new Error('현재 창에서 선택한 입력 및 출력 파일만 보정할 수 있습니다.');
    }
    const { durationMs, fps } = session.selected.metadata;
    if (durationMs === null || fps === null) {
      throw new Error('선택한 영상의 길이와 FPS를 확인할 수 없습니다.');
    }
    if (request.method === 'strong' && !session.selected.capabilities.strong) {
      throw new Error('강력 흔들림 보정은 실제 MP4 검증 전에는 사용할 수 없습니다.');
    }
    if (activeJob) throw new Error('영상 최종 보정이 이미 진행 중입니다.');
    const fingerprintBefore = await getFingerprint(request.sourcePath);
    const controller = new AbortController();
    const lease = options.coordinator.tryAcquire(
      'final-correction', event.sender, () => controller.abort(),
    );
    activeJob = { sender: event.sender, controller, lease };
    const handleDestroyed = (): void => controller.abort();
    event.sender.once('destroyed', handleDestroyed);
    try {
      return await options.correctVideo(request, {
        signal: controller.signal,
        sourceFrameEstimate: Math.max(1, Math.round(
          durationMs / 1_000 * fps,
        )),
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.videoFinalCorrectionProgress, progress);
          }
        },
        beforePublish: async () => {
          const fingerprintAfter = await getFingerprint(request.sourcePath);
          if (!equalFingerprint(fingerprintBefore, fingerprintAfter)) {
            throw new Error('원본 영상이 보정 중 변경되었습니다. 결과를 저장하지 않습니다.');
          }
        },
      });
    } finally {
      event.sender.removeListener('destroyed', handleDestroyed);
      activeJob = null;
      lease.release();
    }
  });
}
