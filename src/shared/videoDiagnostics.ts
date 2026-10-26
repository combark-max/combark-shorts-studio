export const VIDEO_DIAGNOSTIC_THRESHOLDS = {
  sceneScore: 10,
  sceneDedupeMs: 750,
  sceneExclusionMs: 500,
  eventMergeMs: 500,
  jitterMergeMs: 750,
  brightnessDelta: 18,
  translationDiagonalRatio: 0.0025,
  rotationDegrees: 0.25,
  scalePercent: 0.5,
} as const;

export interface VideoMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasVideo: boolean | null;
  hasAudio: boolean | null;
}

export interface SelectedDiagnosticVideo {
  sourcePath: string;
  fileName: string;
  metadata: VideoMetadata;
  probeStatus: 'ready' | 'partial' | 'failed';
  probeMessage?: string;
}

export type DiagnosticType =
  | 'scene-change'
  | 'motion-jump'
  | 'motion-jitter'
  | 'rotation-change'
  | 'scale-change'
  | 'frame-change'
  | 'brightness-change';

export type DiagnosticSeverity = 'info' | 'low' | 'medium' | 'high';
export type DiagnosticConfidence = 'medium' | 'high' | null;

export interface RawDiagnosticEvent {
  type: DiagnosticType;
  timeMs: number;
  scoreMultiple: number | null;
  rawScore: number;
  confidence: DiagnosticConfidence;
}

export interface DiagnosticCandidate {
  type: DiagnosticType;
  startMs: number;
  endMs: number;
  peakMs: number;
  severity: DiagnosticSeverity;
  scoreMultiple: number | null;
  scoreLabel: string;
  confidence: DiagnosticConfidence;
}

export interface DiagnosticUncertainty {
  code:
    | 'insufficient-motion-data'
    | 'poor-motion-coverage'
    | 'unstable-motion-fit'
    | 'partial-metadata';
  message: string;
  startMs?: number;
  endMs?: number;
}

export interface VideoDiagnosticResult {
  candidates: DiagnosticCandidate[];
  uncertainties: DiagnosticUncertainty[];
  notices: string[];
}

export interface VideoDiagnosticProgress {
  stage:
    | 'probing'
    | 'frame-analysis'
    | 'motion-analysis'
    | 'finalizing'
    | 'complete';
  analyzedMs: number | null;
  durationMs: number | null;
  percent: number | null;
}

export function diagnosticCandidateKey(
  candidate: Pick<DiagnosticCandidate, 'type' | 'startMs' | 'endMs' | 'peakMs'>,
): string {
  return [
    candidate.type,
    Math.round(candidate.startMs),
    Math.round(candidate.endMs),
    Math.round(candidate.peakMs),
  ].join(':');
}

const TYPE_PRIORITY: Record<DiagnosticType, number> = {
  'scene-change': 0,
  'motion-jump': 1,
  'motion-jitter': 2,
  'rotation-change': 3,
  'scale-change': 4,
  'frame-change': 5,
  'brightness-change': 6,
};

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidEvent(value: RawDiagnosticEvent): boolean {
  return isFiniteNonNegative(value.timeMs) &&
    isFiniteNonNegative(value.rawScore) &&
    (value.scoreMultiple === null || isFiniteNonNegative(value.scoreMultiple));
}

export function severityForScore(
  scoreMultiple: number,
): Exclude<DiagnosticSeverity, 'info'> {
  if (!Number.isFinite(scoreMultiple) || scoreMultiple < 0) {
    throw new RangeError('진단 점수 배수는 0 이상의 유한한 숫자여야 합니다.');
  }
  if (scoreMultiple >= 4) return 'high';
  if (scoreMultiple >= 2) return 'medium';
  return 'low';
}

export function dedupeSceneCandidates(
  events: RawDiagnosticEvent[],
  minimumGapMs = VIDEO_DIAGNOSTIC_THRESHOLDS.sceneDedupeMs,
): RawDiagnosticEvent[] {
  const scenes = events
    .filter((event) => event.type === 'scene-change' && isValidEvent(event))
    .sort((left, right) => left.timeMs - right.timeMs);
  const deduped: RawDiagnosticEvent[] = [];
  let groupStartTime: number | null = null;

  for (const scene of scenes) {
    if (groupStartTime === null || scene.timeMs - groupStartTime > minimumGapMs) {
      deduped.push(scene);
      groupStartTime = scene.timeMs;
    } else if (scene.rawScore > deduped[deduped.length - 1].rawScore) {
      deduped[deduped.length - 1] = scene;
    }
  }
  return deduped;
}

export function suppressEventsNearScenes(
  events: RawDiagnosticEvent[],
  scenes: RawDiagnosticEvent[],
  radiusMs = VIDEO_DIAGNOSTIC_THRESHOLDS.sceneExclusionMs,
): RawDiagnosticEvent[] {
  const validSceneTimes = scenes
    .filter((scene) => scene.type === 'scene-change' && isValidEvent(scene))
    .map(({ timeMs }) => timeMs);

  return events
    .filter(isValidEvent)
    .filter((event) => event.type === 'scene-change' ||
      validSceneTimes.every((timeMs) => Math.abs(event.timeMs - timeMs) > radiusMs))
    .sort(compareEvents);
}

function compareEvents(left: RawDiagnosticEvent, right: RawDiagnosticEvent): number {
  return left.timeMs - right.timeMs || TYPE_PRIORITY[left.type] - TYPE_PRIORITY[right.type];
}

function peakValue(event: RawDiagnosticEvent): number {
  return event.scoreMultiple ?? event.rawScore;
}

function scoreLabel(event: RawDiagnosticEvent): string {
  if (event.type === 'scene-change') {
    return `FFmpeg 장면 변화 점수 ${event.rawScore.toFixed(2)}`;
  }
  return `진단 기준 대비 ${(event.scoreMultiple ?? 0).toFixed(2)}배`;
}

export function mergeDiagnosticEvents(
  events: RawDiagnosticEvent[],
): DiagnosticCandidate[] {
  const groups: RawDiagnosticEvent[][] = [];
  const byType = new Map<DiagnosticType, RawDiagnosticEvent[]>();
  for (const event of events.filter(isValidEvent).sort(compareEvents)) {
    const sameType = byType.get(event.type) ?? [];
    sameType.push(event);
    byType.set(event.type, sameType);
  }

  for (const typeEvents of byType.values()) {
    let group: RawDiagnosticEvent[] = [];
    for (const event of typeEvents) {
      const mergeGap = event.type === 'motion-jitter'
        ? VIDEO_DIAGNOSTIC_THRESHOLDS.jitterMergeMs
        : VIDEO_DIAGNOSTIC_THRESHOLDS.eventMergeMs;
      const previous = group[group.length - 1];
      if (!previous || event.timeMs - previous.timeMs <= mergeGap) {
        group.push(event);
      } else {
        groups.push(group);
        group = [event];
      }
    }
    if (group.length > 0) groups.push(group);
  }

  return sortDiagnosticCandidates(groups.map((group) => {
    const peak = group.reduce((best, event) =>
      peakValue(event) > peakValue(best) ? event : best);
    return {
      type: peak.type,
      startMs: group[0].timeMs,
      endMs: group[group.length - 1].timeMs,
      peakMs: peak.timeMs,
      severity: peak.type === 'scene-change'
        ? 'info'
        : severityForScore(peak.scoreMultiple ?? 0),
      scoreMultiple: peak.scoreMultiple,
      scoreLabel: scoreLabel(peak),
      confidence: peak.confidence,
    };
  }));
}

export function sortDiagnosticCandidates(
  candidates: DiagnosticCandidate[],
): DiagnosticCandidate[] {
  return [...candidates]
    .filter((candidate) =>
      isFiniteNonNegative(candidate.startMs) &&
      isFiniteNonNegative(candidate.endMs) &&
      isFiniteNonNegative(candidate.peakMs) &&
      candidate.endMs >= candidate.startMs &&
      candidate.peakMs >= candidate.startMs &&
      candidate.peakMs <= candidate.endMs &&
      (candidate.scoreMultiple === null || isFiniteNonNegative(candidate.scoreMultiple)))
    .sort((left, right) =>
      left.peakMs - right.peakMs || TYPE_PRIORITY[left.type] - TYPE_PRIORITY[right.type]);
}
