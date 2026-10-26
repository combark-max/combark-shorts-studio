import { describe, expect, it } from 'vitest';

import {
  planStabilizationPreview,
  StabilizationRangePlanningError,
  type StabilizationPlanningContext,
} from '../../../src/main/video-stabilization/rangePlanning';
import type { DiagnosticCandidate } from '../../../src/shared/videoDiagnostics';
import type { StabilizationPreviewRequest } from '../../../src/shared/videoStabilization';

function candidate(
  type: DiagnosticCandidate['type'] = 'motion-jitter',
  peakMs = 8_000,
  confidence: DiagnosticCandidate['confidence'] = 'high',
): DiagnosticCandidate {
  return {
    type,
    startMs: peakMs - 100,
    endMs: peakMs + 100,
    peakMs,
    severity: 'medium',
    scoreMultiple: 2,
    scoreLabel: 'fixture',
    confidence,
  };
}

const selected = candidate();
const context: StabilizationPlanningContext = {
  candidates: [
    candidate('scene-change', 2_000, null),
    selected,
    candidate('scene-change', 15_000, null),
  ],
  metadata: {
    durationMs: 20_000,
    width: 1_920,
    height: 1_080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
  },
  smoothingFrames: 10,
};

const request: StabilizationPreviewRequest = {
  sourcePath: 'C:\\video.mp4',
  candidateKey: 'motion-jitter:7900:8100:8000',
  selectionMode: 'range',
  requestedStartMs: 5_000,
  requestedEndMs: 10_000,
  sceneBoundaryConfirmed: true,
  scaleMotionConfirmed: false,
  strength: 'weak',
  zoomPercent: 2,
  encoder: 'libx264',
  includeAudio: true,
};

describe('planStabilizationPreview', () => {
  it('normalizes start with floor and exclusive end with ceil at 30 fps', () => {
    const result = planStabilizationPreview({
      ...request,
      requestedStartMs: 5_000.1,
      requestedEndMs: 10_000.1,
    }, context);
    expect(result.operation.correctionStartFrame).toBe(150);
    expect(result.operation.correctionEndFrameExclusive).toBe(301);
  });

  it.each([
    [5_000, 10_000],
    [3_000, 13_000],
  ])('accepts an inclusive duration limit of %sms', (start, end) => {
    expect(() => planStabilizationPreview({
      ...request, requestedStartMs: start, requestedEndMs: end,
    }, context)).not.toThrow();
  });

  it('rejects a nominal ten-second range when frame normalization exceeds the frame-domain limit', () => {
    expect(() => planStabilizationPreview({
      ...request,
      requestedStartMs: 3_000,
      requestedEndMs: 13_000,
    }, {
      ...context,
      metadata: { ...context.metadata, fps: 29.97 },
    })).toThrow('10초');
  });

  it.each([
    [5_001, 10_000],
    [3_000, 13_001],
    [-1, 5_000],
    [Number.NaN, 5_000],
  ])('rejects an invalid or out-of-policy range %s..%s', (start, end) => {
    expect(() => planStabilizationPreview({
      ...request, requestedStartMs: start, requestedEndMs: end,
    }, context)).toThrow(StabilizationRangePlanningError);
  });

  it('requires the selected range to contain the candidate peak', () => {
    expect(() => planStabilizationPreview({
      ...request, requestedStartMs: 9_000, requestedEndMs: 14_000,
    }, context)).toThrow('후보');
  });

  it.each(['scene-change', 'frame-change', 'brightness-change'] as const)(
    'rejects unsupported %s candidates',
    (type) => {
      const unsupported = candidate(type);
      expect(() => planStabilizationPreview({ ...request, candidateKey: `${type}:7900:8100:8000` }, {
        ...context, candidates: [unsupported],
      })).toThrow('적합');
    },
  );

  it('requires high-confidence rotation and explicit scale confirmation', () => {
    const rotation = candidate('rotation-change', 8_000, null);
    expect(() => planStabilizationPreview({
      ...request, candidateKey: 'rotation-change:7900:8100:8000',
    }, { ...context, candidates: [rotation] })).toThrow('신뢰');

    const scale = candidate('scale-change');
    expect(() => planStabilizationPreview({
      ...request, candidateKey: 'scale-change:7900:8100:8000',
    }, { ...context, candidates: [scale] })).toThrow('확인');
  });

  it('requires explicit scene-boundary confirmation', () => {
    expect(() => planStabilizationPreview({
      ...request, sceneBoundaryConfirmed: false,
    }, context)).toThrow('경계');
  });

  it('rejects a range that crosses a detected scene boundary', () => {
    const nearCut = candidate('motion-jump', 14_500);
    expect(() => planStabilizationPreview({
      ...request,
      candidateKey: 'motion-jump:14400:14600:14500',
      requestedStartMs: 13_000,
      requestedEndMs: 18_000,
    }, { ...context, candidates: [...context.candidates, nearCut] })).toThrow('장면');
  });

  it('does not expand a short scene across either cut', () => {
    const short = candidate('motion-jitter', 3_500);
    expect(() => planStabilizationPreview({
      ...request,
      candidateKey: 'motion-jitter:3400:3600:3500',
      selectionMode: 'scene',
      requestedStartMs: 2_000,
      requestedEndMs: 6_000,
    }, {
      ...context,
      candidates: [candidate('scene-change', 2_000, null), short, candidate('scene-change', 6_000, null)],
    })).toThrow('5초');
  });

  it('reserves up to half a second of original handles within ten seconds', () => {
    const result = planStabilizationPreview(request, context);
    expect(result.previewStartFrame).toBe(135);
    expect(result.previewEndFrameExclusive).toBe(315);
    expect(result.headHandleEndFrameExclusive).toBe(150);
    expect(result.tailHandleStartFrame).toBe(300);
    expect(result.joinFramesInPreview).toEqual([
      { join: 'start', frame: 15 },
      { join: 'end', frame: 165 },
    ]);
    expect(result.previewFrameCount).toBe(180);
    expect(result.boundaryMode).toBe('exposed-handles');
  });

  it('keeps both original handles inside the detect and transform input window', () => {
    const result = planStabilizationPreview(request, context);
    expect(result.operation.analysisStartFrame).toBeLessThanOrEqual(result.previewStartFrame);
    expect(result.operation.analysisEndFrameExclusive).toBeGreaterThanOrEqual(
      result.previewEndFrameExclusive,
    );
  });

  it('clips smoothing padding at scene bounds only when a minimum remains', () => {
    const nearStart = candidate('motion-jitter', 4_500);
    const clipped = planStabilizationPreview({
      ...request,
      candidateKey: 'motion-jitter:4400:4600:4500',
      requestedStartMs: 2_100,
      requestedEndMs: 7_100,
    }, { ...context, candidates: [candidate('scene-change', 2_000, null), nearStart] });
    expect(clipped.operation.analysisStartFrame).toBe(60);

    expect(() => planStabilizationPreview({
      ...request,
      candidateKey: 'motion-jitter:4400:4600:4500',
      requestedStartMs: 2_000,
      requestedEndMs: 7_000,
    }, { ...context, candidates: [candidate('scene-change', 2_000, null), nearStart] })).toThrow('여유');
  });
});
