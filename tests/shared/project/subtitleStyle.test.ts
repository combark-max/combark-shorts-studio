import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_POSITION,
  DEFAULT_SUBTITLE_SIZE,
  getSubtitleStyle,
} from '../../../src/shared/project/subtitleStyle';

describe('getSubtitleStyle', () => {
  it('defines the backward-compatible default style', () => {
    expect(DEFAULT_SUBTITLE_POSITION).toBe('bottom');
    expect(DEFAULT_SUBTITLE_SIZE).toBe('medium');
  });

  it.each([
    ['small', 48],
    ['medium', 64],
    ['large', 80],
  ] as const)('maps %s to the canonical export font size', (size, fontSize) => {
    expect(getSubtitleStyle('bottom', size)).toMatchObject({ fontSize });
  });

  it.each([
    ['top', 8],
    ['center', 5],
    ['bottom', 2],
  ] as const)('maps %s to the canonical ASS alignment', (position, alignment) => {
    expect(getSubtitleStyle(position, 'medium')).toMatchObject({ alignment });
  });

  it('provides the existing safe area and normalized preview ratios', () => {
    expect(getSubtitleStyle('bottom', 'medium')).toEqual({
      fontSize: 64,
      alignment: 2,
      horizontalMargin: 80,
      verticalMargin: 150,
      normalizedFontSize: 64 / 1080,
      normalizedHorizontalMargin: 80 / 1080,
      normalizedVerticalMargin: 150 / 1920,
    });
  });
});
