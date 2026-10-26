import type { DiagnosticType } from './videoDiagnostics';

export type StabilizationStrength = 'off' | 'weak' | 'medium';
export type StabilizationZoomPercent = 1 | 2 | 3;
export type StabilizationEncoder = 'libx264' | 'h264_qsv';
export type StabilizationSelectionMode = 'scene' | 'range';

export interface StabilizationPreviewRequest {
  sourcePath: string;
  candidateKey: string;
  selectionMode: StabilizationSelectionMode;
  requestedStartMs: number;
  requestedEndMs: number;
  sceneBoundaryConfirmed: boolean;
  scaleMotionConfirmed: boolean;
  strength: StabilizationStrength;
  zoomPercent: StabilizationZoomPercent;
  encoder: StabilizationEncoder;
  includeAudio: boolean;
}

export interface NormalizedStabilizationOperation {
  id: string;
  sourceStartFrame: number;
  sourceEndFrameExclusive: number;
  sceneStartFrame: number;
  sceneEndFrameExclusive: number;
  analysisStartFrame: number;
  analysisEndFrameExclusive: number;
  correctionStartFrame: number;
  correctionEndFrameExclusive: number;
  strength: StabilizationStrength;
  zoomPercent: StabilizationZoomPercent;
}

export interface StabilizationBoundaryMetric {
  join: 'start' | 'end';
  translationDiagonalRatio: number | null;
  rotationDegrees: number | null;
  scalePercent: number | null;
  confidence: 'medium' | 'high' | null;
}

export interface StabilizationBoundaryAssessment {
  status: 'protected-scene-cut' | 'safe' | 'warning' | 'unverifiable';
  metrics: StabilizationBoundaryMetric[];
  messages: string[];
}

export interface StabilizationPreviewProgress {
  stage: 'planning' | 'detecting' | 'transforming' | 'verifying' | 'complete';
  percent: number | null;
  processedFrames: number | null;
  totalFrames: number | null;
}

export interface StabilizationPreviewResult {
  previewId: string;
  previewPath: string;
  sourceStartMs: number;
  sourceEndMs: number;
  durationMs: number;
  videoFrameCount: number;
  hasAudio: boolean;
  encoderUsed: StabilizationEncoder;
  manifest: StabilizationPreviewManifest;
  boundaryAssessment: StabilizationBoundaryAssessment;
  warnings: string[];
}

export interface StabilizationPreviewManifest {
  sourcePath: string;
  sourceFileName: string;
  candidateKey: string;
  candidateType: DiagnosticType;
  candidatePeakMs: number;
  fps: number;
  previewStartFrame: number;
  previewEndFrameExclusive: number;
  correctionStartFrame: number;
  correctionEndFrameExclusive: number;
  strength: StabilizationStrength;
  requestedZoomPercent: StabilizationZoomPercent;
  appliedZoomPercent: 0 | StabilizationZoomPercent;
  encoder: StabilizationEncoder;
  selectionMode: StabilizationSelectionMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseStabilizationPreviewRequest(value: unknown): StabilizationPreviewRequest {
  if (!isRecord(value)) throw new TypeError('안정화 요청 형식이 올바르지 않습니다.');
  const strength = value.strength;
  const zoomPercent = value.zoomPercent;
  const encoder = value.encoder;
  const selectionMode = value.selectionMode;
  if (strength !== 'off' && strength !== 'weak' && strength !== 'medium') {
    throw new TypeError('지원하지 않는 안정화 강도입니다.');
  }
  if (zoomPercent !== 1 && zoomPercent !== 2 && zoomPercent !== 3) {
    throw new TypeError('지원하지 않는 안정화 확대율입니다.');
  }
  if (encoder !== 'libx264' && encoder !== 'h264_qsv') {
    throw new TypeError('지원하지 않는 안정화 인코더입니다.');
  }
  if (selectionMode !== 'scene' && selectionMode !== 'range') {
    throw new TypeError('지원하지 않는 안정화 선택 방식입니다.');
  }
  if (typeof value.sceneBoundaryConfirmed !== 'boolean' ||
      typeof value.scaleMotionConfirmed !== 'boolean') {
    throw new TypeError('장면 경계와 확대 움직임 확인이 필요합니다.');
  }
  if (typeof value.sourcePath !== 'string' || value.sourcePath.length === 0 ||
      typeof value.candidateKey !== 'string' || value.candidateKey.length === 0 ||
      !isFiniteNonNegative(value.requestedStartMs) ||
      !isFiniteNonNegative(value.requestedEndMs) ||
      value.requestedEndMs <= value.requestedStartMs ||
      typeof value.includeAudio !== 'boolean') {
    throw new TypeError('안정화 요청 값이 올바르지 않습니다.');
  }
  return {
    sourcePath: value.sourcePath,
    candidateKey: value.candidateKey,
    selectionMode,
    requestedStartMs: value.requestedStartMs,
    requestedEndMs: value.requestedEndMs,
    sceneBoundaryConfirmed: value.sceneBoundaryConfirmed,
    scaleMotionConfirmed: value.scaleMotionConfirmed,
    strength,
    zoomPercent,
    encoder,
    includeAudio: value.includeAudio,
  };
}
