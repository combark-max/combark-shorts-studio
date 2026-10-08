import { describe, expect, it } from 'vitest';

import {
  buildPreviewTimeline,
  locatePreviewTime,
} from '../../../src/renderer/project/previewTimeline';
import type { MediaAsset, Scene } from '../../../src/shared/project/types';

const media: MediaAsset[] = [
  {
    id: 'image',
    kind: 'image',
    sourcePath: 'C:\\media\\image.jpg',
    fileName: 'image.jpg',
  },
  {
    id: 'video',
    kind: 'video',
    sourcePath: 'C:\\media\\video.mp4',
    fileName: 'video.mp4',
  },
];

const imageScene: Scene = {
  mediaId: 'image',
  durationMs: 3000,
  playbackDurationMs: null,
  subtitle: '',
  subtitlePosition: 'bottom',
  subtitleSize: 'medium',
};

const videoScene: Scene = {
  mediaId: 'video',
  durationMs: null,
  playbackDurationMs: null,
  subtitle: '',
  subtitlePosition: 'bottom',
  subtitleSize: 'medium',
};

describe('previewTimeline', () => {
  it('builds an integer-millisecond timeline for mixed image and video scenes', () => {
    expect(
      buildPreviewTimeline(
        [imageScene, videoScene, { ...imageScene, durationMs: 2000 }],
        media,
        { video: 4500 },
      ),
    ).toEqual({
      scenes: [
        { sceneIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000 },
        { sceneIndex: 1, startMs: 3000, endMs: 7500, durationMs: 4500 },
        { sceneIndex: 2, startMs: 7500, endMs: 9500, durationMs: 2000 },
      ],
      totalDurationMs: 9500,
    });
  });

  it('reuses one media duration for repeated video scenes', () => {
    expect(
      buildPreviewTimeline([videoScene, videoScene], media, { video: 4250 }),
    ).toEqual({
      scenes: [
        { sceneIndex: 0, startMs: 0, endMs: 4250, durationMs: 4250 },
        { sceneIndex: 1, startMs: 4250, endMs: 8500, durationMs: 4250 },
      ],
      totalDurationMs: 8500,
    });
  });

  it.each([
    [6000, 6000],
    [25_000, 25_000],
  ])('uses an explicit %i ms video playback duration', (playbackDurationMs, expectedDurationMs) => {
    expect(
      buildPreviewTimeline(
        [{ ...videoScene, playbackDurationMs }],
        media,
        { video: 10_000 },
      ),
    ).toEqual({
      scenes: [
        { sceneIndex: 0, startMs: 0, endMs: expectedDurationMs, durationMs: expectedDurationMs },
      ],
      totalDurationMs: expectedDurationMs,
    });
  });

  it.each<[Record<string, number | null>, string]>([
    [{}, 'loading metadata'],
    [{ video: null }, 'failed metadata'],
    [{ video: Number.NaN }, 'invalid metadata'],
  ])('does not expose a partial timeline for %s (%s)', (durations) => {
    expect(
      buildPreviewTimeline([imageScene, videoScene], media, durations),
    ).toBeNull();
  });

  it('returns an empty ready timeline for an empty project', () => {
    expect(buildPreviewTimeline([], media, {})).toEqual({
      scenes: [],
      totalDurationMs: 0,
    });
  });

  it('maps global time into scene-local time with half-open boundaries', () => {
    const timeline = buildPreviewTimeline(
      [imageScene, { ...imageScene, durationMs: 4000 }, videoScene],
      media,
      { video: 5000 },
    );

    expect(timeline).not.toBeNull();
    if (!timeline) {
      throw new Error('Expected a complete preview timeline.');
    }
    expect(locatePreviewTime(timeline, 8500)).toEqual({
      sceneIndex: 2,
      sceneLocalTimeMs: 1500,
      globalTimeMs: 8500,
      atProjectEnd: false,
    });
    expect(locatePreviewTime(timeline, 3000)).toEqual({
      sceneIndex: 1,
      sceneLocalTimeMs: 0,
      globalTimeMs: 3000,
      atProjectEnd: false,
    });
  });

  it('clamps before zero, after the end, and keeps the final endpoint', () => {
    const timeline = buildPreviewTimeline(
      [imageScene, videoScene],
      media,
      { video: 5000 },
    );

    expect(timeline).not.toBeNull();
    if (!timeline) {
      throw new Error('Expected a complete preview timeline.');
    }
    expect(locatePreviewTime(timeline, -200)).toEqual({
      sceneIndex: 0,
      sceneLocalTimeMs: 0,
      globalTimeMs: 0,
      atProjectEnd: false,
    });
    expect(locatePreviewTime(timeline, 10000)).toEqual({
      sceneIndex: 1,
      sceneLocalTimeMs: 5000,
      globalTimeMs: 8000,
      atProjectEnd: true,
    });
  });

  it('returns null when an empty timeline has no scene position', () => {
    expect(
      locatePreviewTime({ scenes: [], totalDurationMs: 0 }, 0),
    ).toBeNull();
  });
});
