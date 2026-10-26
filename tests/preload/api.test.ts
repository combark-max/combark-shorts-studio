import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, on, removeListener, send } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on,
    removeListener,
    send,
  },
}));

import { IPC_CHANNELS } from '../../src/shared/ipc';
import type { VideoDiagnosticResult } from '../../src/shared/videoDiagnostics';
import { desktopApi } from '../../src/preload/api';

describe('desktopApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes only the approved desktop API methods', async () => {
    invoke.mockResolvedValue('1.0.0');

    expect(Object.keys(desktopApi)).toEqual([
      'getAppVersion',
      'openContactSheetImages',
      'analyzeContactSheets',
      'createContactSheetVideo',
      'cancelContactSheetVideo',
      'onContactSheetVideoProgress',
      'selectDiagnosticVideo',
      'analyzeDiagnosticVideo',
      'cancelVideoDiagnostics',
      'onVideoDiagnosticsProgress',
      'createStabilizationPreview',
      'cancelStabilizationPreview',
      'disposeStabilizationPreview',
      'onStabilizationPreviewProgress',
      'selectFinalCorrectionVideo',
      'selectFinalCorrectionOutput',
      'startVideoFinalCorrection',
      'cancelVideoFinalCorrection',
      'onVideoFinalCorrectionProgress',
      'exportMp4',
      'onExportProgress',
      'openMediaDialog',
      'openNarrationDialog',
      'checkProjectSources',
      'relinkSourceFile',
      'openProjectDialog',
      'saveProjectDialog',
      'readProject',
      'writeProject',
      'writeRecovery',
      'deleteRecovery',
      'listRecoveries',
      'listRecentProjects',
      'openRecentProject',
      'removeRecentProject',
      'confirmUnsavedChanges',
      'onWindowCloseRequested',
      'respondToWindowClose',
    ]);

    expect(Object.keys(desktopApi)).not.toContain('recordRecentProject');

    await expect(desktopApi.getAppVersion()).resolves.toBe('1.0.0');
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetVersion);
  });

  it('exposes scoped video diagnostics and removes the exact progress listener', async () => {
    const selected = { sourcePath: 'C:\\video.mp4', fileName: 'video.mp4' };
    const result: VideoDiagnosticResult = { candidates: [], uncertainties: [], notices: [] };
    invoke.mockResolvedValueOnce(selected).mockResolvedValueOnce(result).mockResolvedValueOnce(undefined);

    await expect(desktopApi.selectDiagnosticVideo()).resolves.toBe(selected);
    await expect(desktopApi.analyzeDiagnosticVideo('C:\\video.mp4')).resolves.toBe(result);
    await expect(desktopApi.cancelVideoDiagnostics()).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.videoDiagnosticsSelect],
      [IPC_CHANNELS.videoDiagnosticsAnalyze, 'C:\\video.mp4'],
      [IPC_CHANNELS.videoDiagnosticsCancel],
    ]);

    const listener = vi.fn();
    const cleanup = desktopApi.onVideoDiagnosticsProgress(listener);
    const registered = on.mock.calls.at(-1)?.[1];
    registered({}, { stage: 'probing', analyzedMs: null, durationMs: null, percent: null });
    expect(listener).toHaveBeenCalledOnce();
    cleanup();
    expect(removeListener).toHaveBeenCalledWith(IPC_CHANNELS.videoDiagnosticsProgress, registered);
  });

  it('exposes only scoped stabilization preview operations', async () => {
    const request = {
      sourcePath: 'C:\\video.mp4', candidateKey: 'motion-jitter:1:2:1',
      selectionMode: 'range' as const, requestedStartMs: 0, requestedEndMs: 5_000,
      sceneBoundaryConfirmed: true, scaleMotionConfirmed: false,
      strength: 'weak' as const, zoomPercent: 2 as const,
      encoder: 'libx264' as const, includeAudio: true,
    };
    const result = { previewId: 'id', previewPath: 'C:\\Temp\\preview.mp4' };
    invoke.mockResolvedValueOnce(result).mockResolvedValueOnce(undefined).mockResolvedValueOnce(true);
    await expect(desktopApi.createStabilizationPreview(request)).resolves.toBe(result);
    await expect(desktopApi.cancelStabilizationPreview()).resolves.toBeUndefined();
    await expect(desktopApi.disposeStabilizationPreview('id')).resolves.toBe(true);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.videoStabilizationCreate, request],
      [IPC_CHANNELS.videoStabilizationCancel],
      [IPC_CHANNELS.videoStabilizationDispose, 'id'],
    ]);
    const listener = vi.fn();
    const cleanup = desktopApi.onStabilizationPreviewProgress(listener);
    const registered = on.mock.calls.at(-1)?.[1];
    registered({}, { stage: 'detecting', percent: 25, processedFrames: 25, totalFrames: 100 });
    expect(listener).toHaveBeenCalledOnce();
    cleanup();
    expect(removeListener).toHaveBeenCalledWith(IPC_CHANNELS.videoStabilizationProgress, registered);
  });

  it('exposes only scoped final-correction operations and progress', async () => {
    const selected = { sourcePath: 'C:\\video.mp4', capabilities: { basic: true, strong: false } };
    const request = {
      sourcePath: 'C:\\video.mp4', outputPath: 'C:\\video-corrected.mp4', method: 'basic' as const,
    };
    const result = { ...request, frameCount: 300 };
    invoke.mockResolvedValueOnce(selected)
      .mockResolvedValueOnce(request.outputPath)
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce(undefined);
    await expect(desktopApi.selectFinalCorrectionVideo()).resolves.toBe(selected);
    await expect(desktopApi.selectFinalCorrectionOutput(request.sourcePath)).resolves.toBe(request.outputPath);
    await expect(desktopApi.startVideoFinalCorrection(request)).resolves.toBe(result);
    await expect(desktopApi.cancelVideoFinalCorrection()).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.videoFinalCorrectionSelect],
      [IPC_CHANNELS.videoFinalCorrectionSelectOutput, request.sourcePath],
      [IPC_CHANNELS.videoFinalCorrectionStart, request],
      [IPC_CHANNELS.videoFinalCorrectionCancel],
    ]);
    const listener = vi.fn();
    const cleanup = desktopApi.onVideoFinalCorrectionProgress(listener);
    const registered = on.mock.calls.at(-1)?.[1];
    registered({}, { stage: 'detecting', percent: 25, processedFrames: 90, totalFrames: 360 });
    expect(listener).toHaveBeenCalledOnce();
    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.videoFinalCorrectionProgress,
      registered,
    );
  });

  it('exposes the scoped contact-sheet workflow and progress subscription', async () => {
    const sheets = [
      {
        id: 'sheet-id',
        sourcePath: 'C:\\images\\sheet.png',
        fileName: 'sheet.png',
      },
    ];
    const request = { sheets, fps: 8 as const };
    invoke
      .mockResolvedValueOnce(sheets)
      .mockResolvedValueOnce([
        { id: 'sheet-id', status: 'recognized', frameCount: 16 },
      ])
      .mockResolvedValueOnce({ status: 'success', filePath: 'C:\\out.mp4' })
      .mockResolvedValueOnce(undefined);

    await expect(desktopApi.openContactSheetImages()).resolves.toEqual(sheets);
    await expect(desktopApi.analyzeContactSheets(sheets)).resolves.toEqual([
      { id: 'sheet-id', status: 'recognized', frameCount: 16 },
    ]);
    await expect(desktopApi.createContactSheetVideo(request)).resolves.toEqual({
      status: 'success',
      filePath: 'C:\\out.mp4',
    });
    await expect(desktopApi.cancelContactSheetVideo()).resolves.toBeUndefined();
    expect(invoke.mock.calls.slice(0, 4)).toEqual([
      [IPC_CHANNELS.contactSheetVideoOpen],
      [IPC_CHANNELS.contactSheetVideoAnalyze, sheets],
      [IPC_CHANNELS.contactSheetVideoCreate, request],
      [IPC_CHANNELS.contactSheetVideoCancel],
    ]);

    const listener = vi.fn();
    const cleanup = desktopApi.onContactSheetVideoProgress(listener);
    const registeredListener = on.mock.calls.at(-1)?.[1];
    registeredListener({}, { stage: 'encoding' });
    expect(listener).toHaveBeenCalledWith({ stage: 'encoding' });
    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.contactSheetVideoProgress,
      registeredListener,
    );
  });

  it('subscribes to export progress and removes the exact listener', () => {
    const listener = vi.fn();
    const cleanup = desktopApi.onExportProgress(listener);
    const registeredListener = on.mock.calls[0][1];

    registeredListener({}, { stage: 'scene', sceneIndex: 2, sceneCount: 5 });
    expect(listener).toHaveBeenCalledWith({
      stage: 'scene',
      sceneIndex: 2,
      sceneCount: 5,
    });

    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.exportProgress,
      registeredListener,
    );
  });

  it('invokes the source check and relink channels', async () => {
    const request = {
      media: [{ id: 'photo-id', sourcePath: 'C:\\media\\photo.jpg' }],
      narrationSourcePath: 'C:\\audio\\voice.mp3',
    };
    invoke
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: false })
      .mockResolvedValueOnce({
        sourcePath: 'C:\\new\\photo.png',
        fileName: 'photo.png',
      });

    await expect(desktopApi.checkProjectSources(request)).resolves.toEqual({
      missingMediaIds: [],
      narrationMissing: false,
    });
    await expect(
      desktopApi.relinkSourceFile('image', 'C:\\media\\photo.jpg'),
    ).resolves.toEqual({
      sourcePath: 'C:\\new\\photo.png',
      fileName: 'photo.png',
    });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.projectSourceCheck,
      request,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.sourceRelinkDialog,
      'image',
      'C:\\media\\photo.jpg',
    );
  });

  it('invokes the native unsaved-changes confirmation with its action', async () => {
    invoke.mockResolvedValue('discard');

    await expect(desktopApi.confirmUnsavedChanges('close')).resolves.toBe(
      'discard',
    );
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.projectConfirmUnsavedChanges,
      'close',
    );
  });

  it('subscribes to close requests, cleans up, and sends the decision', () => {
    const listener = vi.fn();
    const cleanup = desktopApi.onWindowCloseRequested(listener);
    const registeredListener = on.mock.calls[0][1];

    registeredListener({});
    expect(listener).toHaveBeenCalledOnce();

    desktopApi.respondToWindowClose(true);
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseResponse,
      true,
    );

    cleanup();
    expect(removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseRequested,
      registeredListener,
    );
  });
});
