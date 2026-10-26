import { app, BrowserWindow } from 'electron';

import { APP_ID } from '../shared/appInfo';
import { createMainWindow } from './createMainWindow';
import { registerAppIpc } from './ipc/registerAppIpc';
import { registerContactSheetVideoIpc } from './ipc/registerContactSheetVideoIpc';
import { registerExportIpc } from './ipc/registerExportIpc';
import { registerProjectIpc } from './ipc/registerProjectIpc';
import {
  DiagnosticSessionStore,
  registerVideoDiagnosticsIpc,
} from './ipc/registerVideoDiagnosticsIpc';
import {
  createFfmpegStabilizationPreview,
  registerVideoStabilizationIpc,
} from './ipc/registerVideoStabilizationIpc';
import { getRuntimeFfmpegPath } from './export/exportProject';
import { correctFinalVideo } from './video-final-correction/correctFinalVideo';
import { registerVideoFinalCorrectionIpc } from './ipc/registerVideoFinalCorrectionIpc';
import { MediaJobCoordinator } from './media-jobs/mediaJobCoordinator';
import { PreviewStore } from './video-stabilization/previewStore';
import { verifyStabilizationPreviewWithFfmpeg } from './video-stabilization/verifyStabilizationPreview';
import {
  registerMediaProtocol,
  registerMediaProtocolScheme,
} from './media/registerMediaProtocol';

app.setAppUserModelId(APP_ID);
registerMediaProtocolScheme();

const mediaJobCoordinator = new MediaJobCoordinator();
const diagnosticSessions = new DiagnosticSessionStore();
const stabilizationPreviews = new PreviewStore();
let shutdownStarted = false;
let shutdownAllowed = false;

void app.whenReady().then(() => {
  registerMediaProtocol();
  registerAppIpc();
  registerContactSheetVideoIpc(mediaJobCoordinator);
  registerExportIpc(mediaJobCoordinator);
  registerProjectIpc();
  registerVideoDiagnosticsIpc(mediaJobCoordinator, diagnosticSessions);
  const ffmpegPath = getRuntimeFfmpegPath(app.isPackaged, process.resourcesPath);
  registerVideoFinalCorrectionIpc({
    coordinator: mediaJobCoordinator,
    correctVideo: (request, options) => correctFinalVideo(request, {
      ffmpegPath,
      onProgress: options.onProgress,
      beforePublish: options.beforePublish,
      sourceFrameEstimate: options.sourceFrameEstimate,
    }, options.signal),
  });
  registerVideoStabilizationIpc({
    coordinator: mediaJobCoordinator,
    sessions: diagnosticSessions,
    previewStore: stabilizationPreviews,
    createPreview: (request, session, options) =>
      createFfmpegStabilizationPreview(request, session, options, {
        ffmpegPath,
        verifyOutput: (input, signal) =>
          verifyStabilizationPreviewWithFfmpeg(input, ffmpegPath, signal),
      }),
  });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (shutdownAllowed) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  mediaJobCoordinator.cancelActive();
  const boundedCleanup = async (): Promise<void> => {
    await mediaJobCoordinator.waitForIdle(5_000);
    await stabilizationPreviews.disposeAll();
  };
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 7_000);
  });
  void Promise.race([boundedCleanup(), timeout]).finally(() => {
    shutdownAllowed = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
