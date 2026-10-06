import type { MediaAsset, Scene } from '../../shared/project/types';

export interface PreviewSceneTiming {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface PreviewTimeline {
  scenes: PreviewSceneTiming[];
  totalDurationMs: number;
}

export interface PreviewPosition {
  sceneIndex: number;
  sceneLocalTimeMs: number;
  globalTimeMs: number;
  atProjectEnd: boolean;
}

export type VideoDurationMsByMediaId = Record<
  string,
  number | null | undefined
>;

export function buildPreviewTimeline(
  scenes: Scene[],
  media: MediaAsset[],
  videoDurationMsByMediaId: VideoDurationMsByMediaId,
): PreviewTimeline | null {
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const sceneTimings: PreviewSceneTiming[] = [];
  let startMs = 0;

  for (const [sceneIndex, scene] of scenes.entries()) {
    const asset = mediaById.get(scene.mediaId);
    const durationMs =
      asset?.kind === 'image'
        ? scene.durationMs
        : asset?.kind === 'video'
          ? videoDurationMsByMediaId[asset.id]
          : null;

    if (
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return null;
    }

    const normalizedDurationMs = Math.round(durationMs);
    const endMs = startMs + normalizedDurationMs;
    sceneTimings.push({
      sceneIndex,
      startMs,
      endMs,
      durationMs: normalizedDurationMs,
    });
    startMs = endMs;
  }

  return {
    scenes: sceneTimings,
    totalDurationMs: startMs,
  };
}

export function locatePreviewTime(
  timeline: PreviewTimeline,
  requestedGlobalTimeMs: number,
): PreviewPosition | null {
  if (timeline.scenes.length === 0) {
    return null;
  }

  const finiteRequestedTime = Number.isFinite(requestedGlobalTimeMs)
    ? requestedGlobalTimeMs
    : 0;
  const globalTimeMs = Math.round(
    Math.min(Math.max(finiteRequestedTime, 0), timeline.totalDurationMs),
  );
  const atProjectEnd = globalTimeMs === timeline.totalDurationMs;
  const scene = atProjectEnd
    ? timeline.scenes[timeline.scenes.length - 1]
    : timeline.scenes.find(({ endMs }) => globalTimeMs < endMs);

  if (!scene) {
    return null;
  }

  return {
    sceneIndex: scene.sceneIndex,
    sceneLocalTimeMs: atProjectEnd
      ? scene.durationMs
      : globalTimeMs - scene.startMs,
    globalTimeMs,
    atProjectEnd,
  };
}
