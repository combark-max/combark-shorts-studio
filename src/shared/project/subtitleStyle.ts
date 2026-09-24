import type { SubtitlePosition, SubtitleSize } from './types';

export const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = 'bottom';
export const DEFAULT_SUBTITLE_SIZE: SubtitleSize = 'medium';

const SUBTITLE_FONT_SIZES: Record<SubtitleSize, number> = {
  small: 48,
  medium: 64,
  large: 80,
};

const SUBTITLE_ALIGNMENTS: Record<SubtitlePosition, number> = {
  top: 8,
  center: 5,
  bottom: 2,
};

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const HORIZONTAL_MARGIN = 80;
const VERTICAL_MARGIN = 150;

export function getSubtitleStyle(
  position: SubtitlePosition,
  size: SubtitleSize,
) {
  const fontSize = SUBTITLE_FONT_SIZES[size];

  return {
    fontSize,
    alignment: SUBTITLE_ALIGNMENTS[position],
    horizontalMargin: HORIZONTAL_MARGIN,
    verticalMargin: VERTICAL_MARGIN,
    normalizedFontSize: fontSize / CANVAS_WIDTH,
    normalizedHorizontalMargin: HORIZONTAL_MARGIN / CANVAS_WIDTH,
    normalizedVerticalMargin: VERTICAL_MARGIN / CANVAS_HEIGHT,
  };
}
