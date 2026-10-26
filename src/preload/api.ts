import { ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  ContactSheetAnalysisResult,
  ContactSheetSource,
  ContactSheetConfiguredSource,
  ContactSheetVideoProgress,
  CreateContactSheetVideoRequest,
  CreateContactSheetVideoResult,
} from '../shared/contactSheetVideo';
import type { ExportMp4Result, ExportProgress } from '../shared/export';
import type {
  SelectedDiagnosticVideo,
  VideoDiagnosticProgress,
  VideoDiagnosticResult,
} from '../shared/videoDiagnostics';
import type {
  StabilizationPreviewProgress,
  StabilizationPreviewRequest,
  StabilizationPreviewResult,
} from '../shared/videoStabilization';
import type {
  SelectedFinalCorrectionVideo,
  VideoFinalCorrectionProgress,
  VideoFinalCorrectionRequest,
  VideoFinalCorrectionResult,
} from '../shared/videoFinalCorrection';
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
  type ProjectSourceCheckRequest,
  type ProjectSourceCheckResult,
  type RelinkedSourceFile,
  type SourceFileKind,
  type UnsavedChangesAction,
  type UnsavedChangesChoice,
} from '../shared/ipc';

export const desktopApi = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
  openContactSheetImages: (): Promise<ContactSheetSource[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.contactSheetVideoOpen),
  analyzeContactSheets: (
    sheets: ContactSheetConfiguredSource[],
  ): Promise<ContactSheetAnalysisResult[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.contactSheetVideoAnalyze, sheets),
  createContactSheetVideo: (
    request: CreateContactSheetVideoRequest,
  ): Promise<CreateContactSheetVideoResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.contactSheetVideoCreate, request),
  cancelContactSheetVideo: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.contactSheetVideoCancel),
  onContactSheetVideoProgress: (
    listener: (progress: ContactSheetVideoProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: ContactSheetVideoProgress,
    ): void => {
      listener(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.contactSheetVideoProgress, handler);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.contactSheetVideoProgress,
        handler,
      );
    };
  },
  selectDiagnosticVideo: (): Promise<SelectedDiagnosticVideo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoDiagnosticsSelect),
  analyzeDiagnosticVideo: (sourcePath: string): Promise<VideoDiagnosticResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoDiagnosticsAnalyze, sourcePath),
  cancelVideoDiagnostics: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoDiagnosticsCancel),
  onVideoDiagnosticsProgress: (
    listener: (progress: VideoDiagnosticProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: VideoDiagnosticProgress,
    ): void => listener(progress);
    ipcRenderer.on(IPC_CHANNELS.videoDiagnosticsProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.videoDiagnosticsProgress, handler);
    };
  },
  createStabilizationPreview: (
    request: StabilizationPreviewRequest,
  ): Promise<StabilizationPreviewResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoStabilizationCreate, request),
  cancelStabilizationPreview: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoStabilizationCancel),
  disposeStabilizationPreview: (previewId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoStabilizationDispose, previewId),
  onStabilizationPreviewProgress: (
    listener: (progress: StabilizationPreviewProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: StabilizationPreviewProgress,
    ): void => listener(progress);
    ipcRenderer.on(IPC_CHANNELS.videoStabilizationProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.videoStabilizationProgress, handler);
    };
  },
  selectFinalCorrectionVideo: (): Promise<SelectedFinalCorrectionVideo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoFinalCorrectionSelect),
  selectFinalCorrectionOutput: (sourcePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoFinalCorrectionSelectOutput, sourcePath),
  startVideoFinalCorrection: (
    request: VideoFinalCorrectionRequest,
  ): Promise<VideoFinalCorrectionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoFinalCorrectionStart, request),
  cancelVideoFinalCorrection: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.videoFinalCorrectionCancel),
  onVideoFinalCorrectionProgress: (
    listener: (progress: VideoFinalCorrectionProgress) => void,
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: VideoFinalCorrectionProgress,
    ): void => listener(progress);
    ipcRenderer.on(IPC_CHANNELS.videoFinalCorrectionProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.videoFinalCorrectionProgress, handler);
    };
  },
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
  checkProjectSources: (
    request: ProjectSourceCheckRequest,
  ): Promise<ProjectSourceCheckResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSourceCheck, request),
  relinkSourceFile: (
    kind: SourceFileKind,
    previousPath: string,
  ): Promise<RelinkedSourceFile | null> =>
    ipcRenderer.invoke(
      IPC_CHANNELS.sourceRelinkDialog,
      kind,
      previousPath,
    ),
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
