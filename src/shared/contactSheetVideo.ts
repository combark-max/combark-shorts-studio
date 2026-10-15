export const CONTACT_SHEET_FPS_VALUES = [8, 10, 12, 16] as const;
export const CONTACT_SHEET_INTERPOLATION_VALUES = [
  'light',
  'medium',
  'strong',
] as const;

export type ContactSheetFps = (typeof CONTACT_SHEET_FPS_VALUES)[number];
export type ContactSheetInterpolation =
  (typeof CONTACT_SHEET_INTERPOLATION_VALUES)[number];

export const CONTACT_SHEET_INTERPOLATION_MULTIPLIERS: Record<
  ContactSheetInterpolation,
  number
> = {
  light: 2,
  medium: 3,
  strong: 4,
};

export interface ContactSheetSource {
  id: string;
  sourcePath: string;
  fileName: string;
}

export interface CreateContactSheetVideoRequest {
  sheets: ContactSheetSource[];
  fps: ContactSheetFps;
  interpolation?: ContactSheetInterpolation;
  outputFps?: ContactSheetOutputFps;
  cropMode?: ContactSheetCropMode;
}

export type ContactSheetAnalysisResult =
  | { id: string; status: 'recognized'; frameCount: 16; details?: ContactSheetDetails }
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

export const CONTACT_SHEET_OUTPUT_FPS_VALUES = [24, 30] as const;
export type ContactSheetOutputFps = (typeof CONTACT_SHEET_OUTPUT_FPS_VALUES)[number];
export type ContactSheetCropMode = 'top-left' | 'center';
export interface ContactSheetDetails {
  width: number;
  height: number;
  boundary?: { first: number[]; last: number[] };
}

// Round only the new mode to the nearest output frame.
export function getContactSheetOutputInfo(
  frameCount: number,
  fps: ContactSheetFps,
  interpolation?: ContactSheetInterpolation,
  outputFps?: ContactSheetOutputFps,
): { frameCount: number; fps: number; duration: number } {
  const rate = outputFps ?? fps;
  const count = outputFps === undefined
    ? frameCount * (interpolation ? CONTACT_SHEET_INTERPOLATION_MULTIPLIERS[interpolation] : 1)
    : Math.round(frameCount * outputFps / fps);
  return { frameCount: count, fps: rate, duration: count / rate };
}

// Sparse 16 x 16 RGB samples of whole boundary cells, not motion recognition.
export function compareContactSheetBoundary(
  previous?: ContactSheetDetails,
  next?: ContactSheetDetails,
): 'normal' | 'warning' | 'unavailable' {
  const first = previous?.boundary?.last;
  const second = next?.boundary?.first;
  if (!first || !second || first.length !== 768 || second.length !== 768 ||
    [...first, ...second].some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return 'unavailable';
  }
  const difference = first.reduce((sum, value, index) => sum + Math.abs(value - second[index]), 0) / (768 * 255);
  return difference >= 0.25 ? 'warning' : 'normal';
}
