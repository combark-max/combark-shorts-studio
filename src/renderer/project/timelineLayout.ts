import type { PreviewSceneTiming } from './previewTimeline';

export const TIMELINE_PIXELS_PER_SECOND = 60;
export const TIMELINE_TICK_INTERVAL_MS = 5000;

export interface TimelinePlaybackSnapshot {
  currentTimeMs: number;
  totalDurationMs: number;
  ready: boolean;
  durationUnavailable?: boolean;
  sceneTimings: PreviewSceneTiming[];
  narrationDurationMs: number | null | undefined;
}

export const EMPTY_TIMELINE_PLAYBACK_SNAPSHOT: TimelinePlaybackSnapshot = {
  currentTimeMs: 0,
  totalDurationMs: 0,
  ready: false,
  durationUnavailable: false,
  sceneTimings: [],
  narrationDurationMs: undefined,
};

export interface TimelineBlockLayout {
  sceneIndex: number;
  leftPx: number;
  widthPx: number;
}

export interface TimelineTickLayout {
  timeMs: number;
  leftPx: number;
}

export interface TimelineLayout {
  canvasWidthPx: number;
  blocks: TimelineBlockLayout[];
  ticks: TimelineTickLayout[];
}

function timeToPixels(timeMs: number, pixelsPerSecond: number): number {
  return (timeMs / 1000) * pixelsPerSecond;
}

export function buildTimelineLayout(
  sceneTimings: PreviewSceneTiming[],
  totalDurationMs: number,
  pixelsPerSecond = TIMELINE_PIXELS_PER_SECOND,
): TimelineLayout {
  const canvasWidthPx = timeToPixels(totalDurationMs, pixelsPerSecond);
  const ticks: TimelineTickLayout[] = [];

  for (
    let timeMs = 0;
    timeMs <= totalDurationMs;
    timeMs += TIMELINE_TICK_INTERVAL_MS
  ) {
    ticks.push({
      timeMs,
      leftPx: timeToPixels(timeMs, pixelsPerSecond),
    });
  }
  if (ticks.at(-1)?.timeMs !== totalDurationMs) {
    ticks.push({
      timeMs: totalDurationMs,
      leftPx: canvasWidthPx,
    });
  }

  return {
    canvasWidthPx,
    blocks: sceneTimings.map((timing) => ({
      sceneIndex: timing.sceneIndex,
      leftPx: timeToPixels(timing.startMs, pixelsPerSecond),
      widthPx: timeToPixels(timing.durationMs, pixelsPerSecond),
    })),
    ticks,
  };
}

export function getPlayheadLeftPx(
  currentTimeMs: number,
  totalDurationMs: number,
  pixelsPerSecond = TIMELINE_PIXELS_PER_SECOND,
): number {
  const clampedTimeMs = Math.min(
    Math.max(Number.isFinite(currentTimeMs) ? currentTimeMs : 0, 0),
    totalDurationMs,
  );
  return timeToPixels(clampedTimeMs, pixelsPerSecond);
}
