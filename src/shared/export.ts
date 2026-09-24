export type ExportMp4Result =
  | { status: 'canceled' }
  | { status: 'success'; filePath: string };

export type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

export type ExportProgress =
  | { stage: 'preparing' }
  | { stage: 'scene'; sceneIndex: number; sceneCount: number }
  | { stage: 'concatenating' }
  | { stage: 'muxing-audio' }
  | { stage: 'writing-output' }
  | { stage: 'complete' };
