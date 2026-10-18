import { nativeImage } from 'electron';
import { readFileSync } from 'node:fs';

import {
  CONTACT_SHEET_GRID_MAX,
  CONTACT_SHEET_GRID_MIN,
  CONTACT_SHEET_MAX_FRAMES,
  type ContactSheetFrameRect,
  type ContactSheetGrid,
} from '../../shared/contactSheetVideo';

export interface ContactSheetBitmap {
  width: number;
  height: number;
  data: Buffer;
}

export interface ContactSheetAnalysis {
  width: number;
  height: number;
  rows: number;
  columns: number;
  frames: ContactSheetFrameRect[];
}

export interface LoadedContactSheetImage {
  image: Electron.NativeImage;
  bitmap: ContactSheetBitmap;
}

interface SeparatorBand {
  start: number;
  end: number;
}

const CHANNEL_COUNT = 4;
const MIN_BOUNDARY_SCORE = 8;
const BOUNDARY_SEARCH_RATIO = 0.04;
const MAX_SEPARATOR_RADIUS = 6;
const LOCAL_SEPARATOR_SCORE_RATIO = 0.2;
const DEFAULT_GRID: ContactSheetGrid = { rows: 4, columns: 4 };

export function validateContactSheetGrid(grid: ContactSheetGrid): void {
  if (
    !Number.isSafeInteger(grid?.rows) ||
    !Number.isSafeInteger(grid?.columns) ||
    grid.rows < CONTACT_SHEET_GRID_MIN ||
    grid.columns < CONTACT_SHEET_GRID_MIN ||
    grid.rows > CONTACT_SHEET_GRID_MAX ||
    grid.columns > CONTACT_SHEET_GRID_MAX ||
    grid.rows * grid.columns > CONTACT_SHEET_MAX_FRAMES
  ) {
    throw new Error('행과 열은 각각 1~12 범위이며 최대 144프레임이어야 합니다.');
  }
}

function validateBitmap(bitmap: ContactSheetBitmap): void {
  if (
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width < 16 ||
    bitmap.height < 16 ||
    bitmap.data.length !== bitmap.width * bitmap.height * CHANNEL_COUNT
  ) {
    throw new Error('손상되었거나 지원할 수 없는 이미지입니다.');
  }
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * CHANNEL_COUNT;
}

function buildGrayscale(bitmap: ContactSheetBitmap): Float64Array {
  const grayscale = new Float64Array(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = pixelOffset(bitmap.width, x, y);
      grayscale[y * bitmap.width + x] =
        bitmap.data[offset] * 0.114 +
        bitmap.data[offset + 1] * 0.587 +
        bitmap.data[offset + 2] * 0.299;
    }
  }
  return grayscale;
}

function percentile75(values: number[]): number {
  values.sort((first, second) => first - second);
  const rank = (values.length - 1) * 0.75;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const fraction = rank - lowerIndex;
  return (
    values[lowerIndex] * (1 - fraction) + values[upperIndex] * fraction
  );
}

function scoreBoundary(
  bitmap: ContactSheetBitmap,
  grayscale: Float64Array,
  axis: 'x' | 'y',
  position: number,
): number {
  const crossLength = axis === 'x' ? bitmap.height : bitmap.width;
  const differences = Array.from({ length: crossLength }, (_, cross) => {
    const firstX = axis === 'x' ? position - 1 : cross;
    const firstY = axis === 'x' ? cross : position - 1;
    const secondX = axis === 'x' ? position : cross;
    const secondY = axis === 'x' ? cross : position;
    return Math.abs(
      grayscale[secondY * bitmap.width + secondX] -
        grayscale[firstY * bitmap.width + firstX],
    );
  });
  const mean =
    differences.reduce((total, value) => total + value, 0) /
    differences.length;
  return mean + percentile75(differences);
}

function findSeparatorBand(
  bitmap: ContactSheetBitmap,
  grayscale: Float64Array,
  axis: 'x' | 'y',
  expectedPosition: number,
): SeparatorBand {
  const axisLength = axis === 'x' ? bitmap.width : bitmap.height;
  const searchRadius = Math.max(
    4,
    Math.ceil(axisLength * BOUNDARY_SEARCH_RATIO),
  );
  const searchStart = Math.max(1, Math.floor(expectedPosition - searchRadius));
  const searchEnd = Math.min(
    axisLength - 1,
    Math.ceil(expectedPosition + searchRadius),
  );
  const scoreCache = new Map<number, number>();
  const scoreAt = (position: number): number => {
    const cached = scoreCache.get(position);
    if (cached !== undefined) {
      return cached;
    }
    const score = scoreBoundary(bitmap, grayscale, axis, position);
    scoreCache.set(position, score);
    return score;
  };
  let boundary = searchStart;
  let boundaryScore = scoreAt(boundary);

  for (let position = searchStart + 1; position <= searchEnd; position += 1) {
    const score = scoreAt(position);
    const isCloserTie =
      score === boundaryScore &&
      Math.abs(position - expectedPosition) <
        Math.abs(boundary - expectedPosition);
    if (score > boundaryScore || isCloserTie) {
      boundary = position;
      boundaryScore = score;
    }
  }

  if (boundaryScore < MIN_BOUNDARY_SCORE) {
    throw new Error('4×4 separator 경계를 찾지 못했습니다.');
  }

  const localStart = Math.max(1, boundary - MAX_SEPARATOR_RADIUS);
  const localEnd = Math.min(axisLength - 1, boundary + MAX_SEPARATOR_RADIUS);
  const localThreshold = Math.max(
    MIN_BOUNDARY_SCORE,
    boundaryScore * LOCAL_SEPARATOR_SCORE_RATIO,
  );
  const separatorEdges: number[] = [];
  for (let position = localStart; position <= localEnd; position += 1) {
    if (scoreAt(position) >= localThreshold) {
      separatorEdges.push(position);
    }
  }

  return {
    start: Math.min(...separatorEdges),
    end: Math.max(...separatorEdges),
  };
}

function findContentRanges(
  bitmap: ContactSheetBitmap,
  grayscale: Float64Array,
  axis: 'x' | 'y',
  rangeCount: number,
): Array<{ start: number; end: number }> {
  const axisLength = axis === 'x' ? bitmap.width : bitmap.height;
  const separators = Array.from({ length: rangeCount - 1 }, (_, index) =>
    findSeparatorBand(
      bitmap,
      grayscale,
      axis,
      (axisLength * (index + 1)) / rangeCount,
    ),
  );
  const ranges = Array.from({ length: rangeCount }, (_, index) => ({
    start: index === 0 ? 0 : separators[index - 1].end,
    end: index === rangeCount - 1 ? axisLength : separators[index].start,
  }));

  if (
    ranges.some(({ start, end }) => end <= start) ||
    separators.some(
      (separator, index) =>
        index > 0 && separator.start <= separators[index - 1].end,
    )
  ) {
    throw new Error(`${rangeCount}개 구간의 separator 경계를 찾지 못했습니다.`);
  }

  return ranges;
}

export function analyzeContactSheetBitmap(
  bitmap: ContactSheetBitmap,
  grid: ContactSheetGrid = DEFAULT_GRID,
): ContactSheetAnalysis {
  validateContactSheetGrid(grid);
  validateBitmap(bitmap);
  const grayscale = buildGrayscale(bitmap);
  const columns = findContentRanges(bitmap, grayscale, 'x', grid.columns);
  const rows = findContentRanges(bitmap, grayscale, 'y', grid.rows);
  const frames = rows.flatMap(({ start: y, end: bottom }) =>
    columns.map(({ start: x, end: right }) => ({
      x,
      y,
      width: right - x,
      height: bottom - y,
    })),
  );

  return {
    width: bitmap.width,
    height: bitmap.height,
    rows: grid.rows,
    columns: grid.columns,
    frames,
  };
}

export function analyzeContactSheet(
  sourcePath: string,
  grid: ContactSheetGrid = DEFAULT_GRID,
): ContactSheetAnalysis {
  return analyzeContactSheetBitmap(loadContactSheetImage(sourcePath).bitmap, grid);
}

export function loadContactSheetImage(
  sourcePath: string,
): LoadedContactSheetImage {
  const encodedImage = readFileSync(sourcePath);
  const image = nativeImage.createFromBuffer(encodedImage, { scaleFactor: 1 });
  if (image.isEmpty()) {
    throw new Error('손상되었거나 지원할 수 없는 이미지입니다.');
  }
  const { width, height } = image.getSize(1);
  const bitmap = {
    width,
    height,
    data: image.toBitmap({ scaleFactor: 1 }),
  };
  validateBitmap(bitmap);
  return { image, bitmap };
}
