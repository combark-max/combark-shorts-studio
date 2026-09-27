export const CONTACT_SHEET_FPS_VALUES = [8, 10, 12, 16] as const;

export type ContactSheetFps = (typeof CONTACT_SHEET_FPS_VALUES)[number];

export interface ContactSheetSource {
  id: string;
  sourcePath: string;
  fileName: string;
}

export interface CreateContactSheetVideoRequest {
  sheets: ContactSheetSource[];
  fps: ContactSheetFps;
}

export type ContactSheetAnalysisResult =
  | { id: string; status: 'recognized'; frameCount: 16 }
  | { id: string; status: 'failed'; message: string };

export type ContactSheetVideoProgress =
  | { stage: 'analyzing'; sheetIndex: number; sheetCount: number }
  | { stage: 'extracting'; frameIndex: number; frameCount: number }
  | { stage: 'encoding' }
  | { stage: 'writing-output' }
  | { stage: 'complete' };

export type CreateContactSheetVideoResult =
  | { status: 'canceled' }
  | { status: 'success'; filePath: string };

