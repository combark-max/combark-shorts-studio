import type { MediaAsset, Scene } from './types';

export function getEffectiveSceneDurationMs(
  scene: Scene,
  mediaKind: MediaAsset['kind'],
  sourceVideoDurationMs: number | null | undefined,
): number | null | undefined {
  return mediaKind === 'image'
    ? scene.durationMs
    : scene.playbackDurationMs ?? sourceVideoDurationMs;
}
