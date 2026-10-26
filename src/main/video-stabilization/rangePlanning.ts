import {
  diagnosticCandidateKey,
  type DiagnosticCandidate,
  type VideoMetadata,
} from '../../shared/videoDiagnostics';
import type {
  NormalizedStabilizationOperation,
  StabilizationPreviewRequest,
} from '../../shared/videoStabilization';

const MIN_PREVIEW_MS = 5_000;
const MAX_PREVIEW_MS = 10_000;
const HANDLE_MS = 500;

export class StabilizationRangePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StabilizationRangePlanningError';
  }
}

export interface StabilizationPlanningContext {
  candidates: DiagnosticCandidate[];
  metadata: VideoMetadata;
  smoothingFrames: number;
}

export interface StabilizationRangePlan {
  operation: NormalizedStabilizationOperation;
  previewStartFrame: number;
  previewEndFrameExclusive: number;
  headHandleEndFrameExclusive: number | null;
  tailHandleStartFrame: number | null;
  analysisFrameCount: number;
  previewFrameCount: number;
  joinFramesInPreview: Array<{ join: 'start' | 'end'; frame: number }>;
  boundaryMode: 'scene-cuts' | 'exposed-handles';
}

function floorFrame(timeMs: number, fps: number): number {
  return Math.floor(timeMs * fps / 1_000);
}

function ceilFrame(timeMs: number, fps: number): number {
  return Math.ceil(timeMs * fps / 1_000);
}

function requirePlanningMetadata(metadata: VideoMetadata): {
  fps: number;
  durationMs: number;
} {
  if (metadata.hasVideo !== true || metadata.fps === null || metadata.durationMs === null ||
      !Number.isFinite(metadata.fps) || metadata.fps <= 0 ||
      !Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0) {
    throw new StabilizationRangePlanningError('프레임 범위를 계산할 영상 정보가 부족합니다.');
  }
  return { fps: metadata.fps, durationMs: metadata.durationMs };
}

function assertEligible(
  candidate: DiagnosticCandidate,
  request: StabilizationPreviewRequest,
): void {
  if (candidate.type === 'motion-jump' || candidate.type === 'motion-jitter') return;
  if (candidate.type === 'rotation-change') {
    if (candidate.confidence === 'high') return;
    throw new StabilizationRangePlanningError('회전 후보의 신뢰도가 충분하지 않아 안정화에 적합하지 않습니다.');
  }
  if (candidate.type === 'scale-change') {
    if (request.scaleMotionConfirmed) return;
    throw new StabilizationRangePlanningError('확대 움직임 손실 가능성을 확인해야 합니다.');
  }
  throw new StabilizationRangePlanningError('선택한 진단 후보는 안정화에 적합하지 않습니다.');
}

function sceneBounds(
  candidate: DiagnosticCandidate,
  candidates: DiagnosticCandidate[],
  durationMs: number,
): { startMs: number; endMs: number } {
  const cuts = candidates
    .filter(({ type, peakMs }) => type === 'scene-change' &&
      Number.isFinite(peakMs) && peakMs > 0 && peakMs < durationMs)
    .map(({ peakMs }) => peakMs)
    .sort((left, right) => left - right);
  let startMs = 0;
  let endMs = durationMs;
  for (const cut of cuts) {
    if (cut <= candidate.peakMs) startMs = cut;
    if (cut > candidate.peakMs) {
      endMs = cut;
      break;
    }
  }
  return { startMs, endMs };
}

export function planStabilizationPreview(
  request: StabilizationPreviewRequest,
  context: StabilizationPlanningContext,
): StabilizationRangePlan {
  const { fps, durationMs } = requirePlanningMetadata(context.metadata);
  if (!request.sceneBoundaryConfirmed) {
    throw new StabilizationRangePlanningError('사용자가 장면 경계를 확인해야 합니다.');
  }
  const candidate = context.candidates.find((value) =>
    diagnosticCandidateKey(value) === request.candidateKey);
  if (!candidate) throw new StabilizationRangePlanningError('선택한 진단 후보를 찾을 수 없습니다.');
  assertEligible(candidate, request);

  if (!Number.isFinite(request.requestedStartMs) || !Number.isFinite(request.requestedEndMs) ||
      request.requestedStartMs < 0 || request.requestedEndMs <= request.requestedStartMs) {
    throw new StabilizationRangePlanningError('시험 범위가 올바르지 않습니다.');
  }

  const scene = sceneBounds(candidate, context.candidates, durationMs);
  const correctionStartMs = request.selectionMode === 'scene'
    ? scene.startMs
    : request.requestedStartMs;
  const correctionEndMs = request.selectionMode === 'scene'
    ? scene.endMs
    : request.requestedEndMs;
  const duration = correctionEndMs - correctionStartMs;
  if (duration < MIN_PREVIEW_MS) {
    throw new StabilizationRangePlanningError('시험 보정 구간은 5초 이상이어야 합니다.');
  }
  if (duration > MAX_PREVIEW_MS) {
    throw new StabilizationRangePlanningError('시험 보정 구간은 10초를 넘을 수 없습니다.');
  }
  if (candidate.peakMs < correctionStartMs || candidate.peakMs >= correctionEndMs) {
    throw new StabilizationRangePlanningError('시험 범위가 선택한 후보의 최고점을 포함해야 합니다.');
  }
  if (correctionStartMs < scene.startMs || correctionEndMs > scene.endMs) {
    throw new StabilizationRangePlanningError('시험 범위가 확인된 장면 경계를 넘습니다.');
  }

  const sceneStartFrame = floorFrame(scene.startMs, fps);
  const sceneEndFrameExclusive = ceilFrame(scene.endMs, fps);
  const correctionStartFrame = floorFrame(correctionStartMs, fps);
  const correctionEndFrameExclusive = ceilFrame(correctionEndMs, fps);
  const correctionFrameCount = correctionEndFrameExclusive - correctionStartFrame;
  const minimumCorrectionFrames = Math.ceil(MIN_PREVIEW_MS * fps / 1_000);
  const maximumCorrectionFrames = Math.floor(MAX_PREVIEW_MS * fps / 1_000);
  if (correctionFrameCount < minimumCorrectionFrames) {
    throw new StabilizationRangePlanningError('정규화된 시험 보정 구간은 5초 이상이어야 합니다.');
  }
  if (correctionFrameCount > maximumCorrectionFrames) {
    throw new StabilizationRangePlanningError('정규화된 시험 보정 구간은 10초를 넘을 수 없습니다.');
  }
  const smoothingFrames = Math.max(0, Math.floor(context.smoothingFrames));
  let analysisStartFrame = correctionStartFrame;
  let analysisEndFrameExclusive = correctionEndFrameExclusive;
  if (request.selectionMode === 'range' && smoothingFrames > 0) {
    analysisStartFrame = Math.max(sceneStartFrame, correctionStartFrame - smoothingFrames);
    analysisEndFrameExclusive = Math.min(
      sceneEndFrameExclusive,
      correctionEndFrameExclusive + smoothingFrames,
    );
    const minimumPadding = Math.min(3, smoothingFrames);
    if (correctionStartFrame - analysisStartFrame < minimumPadding ||
        analysisEndFrameExclusive - correctionEndFrameExclusive < minimumPadding) {
      throw new StabilizationRangePlanningError('장면 안에 안정화 분석 여유 프레임이 부족합니다.');
    }
  } else if (request.selectionMode === 'scene') {
    analysisStartFrame = sceneStartFrame;
    analysisEndFrameExclusive = sceneEndFrameExclusive;
  }

  let previewStartFrame = correctionStartFrame;
  let previewEndFrameExclusive = correctionEndFrameExclusive;
  let headHandleEndFrameExclusive: number | null = null;
  let tailHandleStartFrame: number | null = null;
  const joinFramesInPreview: Array<{ join: 'start' | 'end'; frame: number }> = [];
  if (request.selectionMode === 'range') {
    const coreFrames = correctionFrameCount;
    const maximumFrames = Math.floor(MAX_PREVIEW_MS * fps / 1_000);
    const handleFrames = Math.floor(HANDLE_MS * fps / 1_000);
    const available = Math.max(0, maximumFrames - coreFrames);
    const headFrames = Math.min(
      handleFrames,
      correctionStartFrame - sceneStartFrame,
      Math.floor(available / 2),
    );
    const tailFrames = Math.min(
      handleFrames,
      sceneEndFrameExclusive - correctionEndFrameExclusive,
      available - headFrames,
    );
    previewStartFrame -= headFrames;
    previewEndFrameExclusive += tailFrames;
    if (headFrames > 0) {
      headHandleEndFrameExclusive = correctionStartFrame;
      joinFramesInPreview.push({ join: 'start', frame: headFrames });
    }
    if (tailFrames > 0) {
      tailHandleStartFrame = correctionEndFrameExclusive;
      joinFramesInPreview.push({
        join: 'end',
        frame: correctionEndFrameExclusive - previewStartFrame,
      });
    }
    analysisStartFrame = Math.min(analysisStartFrame, previewStartFrame);
    analysisEndFrameExclusive = Math.max(analysisEndFrameExclusive, previewEndFrameExclusive);
  }

  const operation: NormalizedStabilizationOperation = {
    id: request.candidateKey,
    sourceStartFrame: previewStartFrame,
    sourceEndFrameExclusive: previewEndFrameExclusive,
    sceneStartFrame,
    sceneEndFrameExclusive,
    analysisStartFrame,
    analysisEndFrameExclusive,
    correctionStartFrame,
    correctionEndFrameExclusive,
    strength: request.strength,
    zoomPercent: request.zoomPercent,
  };
  return {
    operation,
    previewStartFrame,
    previewEndFrameExclusive,
    headHandleEndFrameExclusive,
    tailHandleStartFrame,
    analysisFrameCount: analysisEndFrameExclusive - analysisStartFrame,
    previewFrameCount: previewEndFrameExclusive - previewStartFrame,
    joinFramesInPreview,
    boundaryMode: request.selectionMode === 'scene' ? 'scene-cuts' : 'exposed-handles',
  };
}
