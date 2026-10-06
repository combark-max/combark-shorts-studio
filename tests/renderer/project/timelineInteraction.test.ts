import { describe, expect, it } from 'vitest';

import {
  buildDraftTimelineBlocks,
  getSceneInsertionIndex,
  getSceneMoveTargetIndex,
  getSelectedSceneIndexAfterMove,
  getSnappedImageDurationMs,
} from '../../../src/renderer/project/timelineInteraction';

const blocks = [
  { sceneIndex: 0, leftPx: 0, widthPx: 180 },
  { sceneIndex: 1, leftPx: 180, widthPx: 240 },
  { sceneIndex: 2, leftPx: 420, widthPx: 120 },
];

describe('timelineInteraction', () => {
  it('finds insertion boundaries from scene block midpoints', () => {
    expect(getSceneInsertionIndex(-10, blocks)).toBe(0);
    expect(getSceneInsertionIndex(89, blocks)).toBe(0);
    expect(getSceneInsertionIndex(90, blocks)).toBe(1);
    expect(getSceneInsertionIndex(299, blocks)).toBe(1);
    expect(getSceneInsertionIndex(300, blocks)).toBe(2);
    expect(getSceneInsertionIndex(600, blocks)).toBe(3);
  });

  it('converts insertion boundaries into final reorder indexes', () => {
    expect(getSceneMoveTargetIndex(2, 1, 4)).toBe(1);
    expect(getSceneMoveTargetIndex(0, 4, 4)).toBe(3);
    expect(getSceneMoveTargetIndex(3, 0, 4)).toBe(0);
    expect(getSceneMoveTargetIndex(1, 2, 4)).toBe(1);
  });

  it('keeps the same logical scene selected after a multi-index move', () => {
    expect(getSelectedSceneIndexAfterMove(3, 3, 1)).toBe(1);
    expect(getSelectedSceneIndexAfterMove(1, 3, 1)).toBe(2);
    expect(getSelectedSceneIndexAfterMove(2, 0, 3)).toBe(1);
    expect(getSelectedSceneIndexAfterMove(0, 0, 3)).toBe(3);
    expect(getSelectedSceneIndexAfterMove(4, 0, 3)).toBe(4);
    expect(getSelectedSceneIndexAfterMove(null, 0, 3)).toBeNull();
  });

  it('snaps image durations to 100ms and clamps them to 500ms', () => {
    expect(getSnappedImageDurationMs(3000, 37)).toBe(3600);
    expect(getSnappedImageDurationMs(3000, -500)).toBe(500);
    expect(getSnappedImageDurationMs(3000, 0)).toBe(3000);
  });

  it('resizes one block and shifts every following scene in draft geometry', () => {
    expect(buildDraftTimelineBlocks(blocks, 0, 4000)).toEqual([
      { sceneIndex: 0, leftPx: 0, widthPx: 240 },
      { sceneIndex: 1, leftPx: 240, widthPx: 240 },
      { sceneIndex: 2, leftPx: 480, widthPx: 120 },
    ]);
  });
});
