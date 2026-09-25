export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  exportMp4: 'export:mp4',
  exportProgress: 'export:progress',
  mediaOpenDialog: 'media:open-dialog',
  narrationOpenDialog: 'narration:open-dialog',
  projectSourceCheck: 'project:source-check',
  sourceRelinkDialog: 'source:relink-dialog',
  projectOpenDialog: 'project:open-dialog',
  projectSaveDialog: 'project:save-dialog',
  projectRead: 'project:read',
  projectWrite: 'project:write',
  projectRecoveryWrite: 'project:recovery-write',
  projectRecoveryDelete: 'project:recovery-delete',
  projectRecoveryList: 'project:recovery-list',
  projectRecentList: 'project:recent-list',
  projectRecentOpen: 'project:recent-open',
  projectRecentRemove: 'project:recent-remove',
  projectConfirmUnsavedChanges: 'project:confirm-unsaved-changes',
  windowCloseRequested: 'window:close-requested',
  windowCloseResponse: 'window:close-response',
} as const;

export type UnsavedChangesAction = 'new' | 'open' | 'recent' | 'close';
export type UnsavedChangesChoice = 'save' | 'discard' | 'cancel';

export type SourceFileKind = 'image' | 'video' | 'narration';

export interface ProjectSourceCheckRequest {
  media: Array<{ id: string; sourcePath: string }>;
  narrationSourcePath: string | null;
}

export interface ProjectSourceCheckResult {
  missingMediaIds: string[];
  narrationMissing: boolean;
}

export interface RelinkedSourceFile {
  sourcePath: string;
  fileName: string;
}
