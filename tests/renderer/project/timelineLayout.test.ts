import { describe, expect, it } from 'vitest';

import {
  buildTimelineLayout,
  getPlayheadLeftPx,
} from '../../../src/renderer/project/timelineLayout';

describe('timelineLayout', () => {
  it('converts millisecond scene timing into proportional horizontal blocks', () => {
    expect(
      buildTimelineLayout(
        [
          { sceneIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000 },
          { sceneIndex: 1, startMs: 3000, endMs: 7000, durationMs: 4000 },
        ],
        7000,
        60,
      ),
    ).toEqual({
      canvasWidthPx: 420,
      blocks: [
        { sceneIndex: 0, leftPx: 0, widthPx: 180 },
        { sceneIndex: 1, leftPx: 180, widthPx: 240 },
      ],
      ticks: [
        { timeMs: 0, leftPx: 0 },
        { timeMs: 5000, leftPx: 300 },
        { timeMs: 7000, leftPx: 420 },
      ],
    });
  });

  it('clamps the playhead to the project range', () => {
    expect(getPlayheadLeftPx(-100, 7000, 60)).toBe(0);
    expect(getPlayheadLeftPx(3500, 7000, 60)).toBe(210);
    expect(getPlayheadLeftPx(9000, 7000, 60)).toBe(420);
  });
});
