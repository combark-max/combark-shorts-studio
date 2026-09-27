import { describe, expect, it, vi } from 'vitest';

const { createFromBuffer, readFileSync } = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer },
}));
vi.mock('node:fs', () => ({
  default: { readFileSync },
  readFileSync,
}));

import {
  analyzeContactSheet,
  analyzeContactSheetBitmap,
  type ContactSheetBitmap,
} from '../../../src/main/contact-sheet/analyzeContactSheet';

interface SheetFixture {
  bitmap: ContactSheetBitmap;
  expectedFrames: Array<{ x: number; y: number; width: number; height: number }>;
}

function createSheetFixture(
  columnWidths = [20, 22, 19, 21],
  rowHeights = [18, 21, 20, 19],
  verticalSeparators = [3, 2, 4],
  horizontalSeparators = [2, 4, 3],
): SheetFixture {
  const width = columnWidths.reduce((total, value) => total + value, 0) +
    verticalSeparators.reduce((total, value) => total + value, 0);
  const height = rowHeights.reduce((total, value) => total + value, 0) +
    horizontalSeparators.reduce((total, value) => total + value, 0);
  const data = Buffer.alloc(width * height * 4);
  const expectedFrames: SheetFixture['expectedFrames'] = [];
  let y = 0;

  for (let row = 0; row < 4; row += 1) {
    let x = 0;
    for (let column = 0; column < 4; column += 1) {
      const frameIndex = row * 4 + column;
      const color = [
        20 + frameIndex * 11,
        40 + frameIndex * 7,
        60 + frameIndex * 5,
      ];
      expectedFrames.push({
        x,
        y,
        width: columnWidths[column],
        height: rowHeights[row],
      });
      for (let pixelY = y; pixelY < y + rowHeights[row]; pixelY += 1) {
        for (let pixelX = x; pixelX < x + columnWidths[column]; pixelX += 1) {
          const offset = (pixelY * width + pixelX) * 4;
          data[offset] = color[2];
          data[offset + 1] = color[1];
          data[offset + 2] = color[0];
          data[offset + 3] = 255;
        }
      }
      x += columnWidths[column];
      if (column < 3) {
        for (let pixelY = y; pixelY < y + rowHeights[row]; pixelY += 1) {
          for (let pixelX = x; pixelX < x + verticalSeparators[column]; pixelX += 1) {
            const offset = (pixelY * width + pixelX) * 4;
            data.fill(245, offset, offset + 3);
            data[offset + 3] = 255;
          }
        }
        x += verticalSeparators[column];
      }
    }
    y += rowHeights[row];
    if (row < 3) {
      for (let pixelY = y; pixelY < y + horizontalSeparators[row]; pixelY += 1) {
        for (let pixelX = 0; pixelX < width; pixelX += 1) {
          const offset = (pixelY * width + pixelX) * 4;
          data.fill(245, offset, offset + 3);
          data[offset + 3] = 255;
        }
      }
      y += horizontalSeparators[row];
    }
  }

  return { bitmap: { width, height, data }, expectedFrames };
}

function createRealisticBoundaryFixture(): SheetFixture {
  const width = 1536;
  const height = 1024;
  const data = Buffer.alloc(width * height * 4);
  const xBoundaries = [0, 385, 769, 1151, width];
  const yBoundaries = [0, 252, 508, 761, height];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = 35 + ((x * 13 + y * 7) % 45);
      const offset = (y * width + x) * 4;
      data.fill(value, offset, offset + 3);
      data[offset + 3] = 255;
    }
  }

  for (const [start, end] of [[334, 346], [718, 730]] as const) {
    for (let y = 0; y < height; y += 1) {
      for (let x = start; x < end; x += 1) {
        const offset = (y * width + x) * 4;
        data.fill(82, offset, offset + 3);
      }
    }
  }

  for (const boundary of xBoundaries.slice(1, -1)) {
    for (let y = 0; y < height; y += 1) {
      for (let x = boundary - 2; x < boundary; x += 1) {
        const offset = (y * width + x) * 4;
        data.fill(245, offset, offset + 3);
      }
      const boundaryOffset = (y * width + boundary) * 4;
      data.fill(12, boundaryOffset, boundaryOffset + 3);
    }
  }

  for (const boundary of yBoundaries.slice(1, -1)) {
    for (let x = 0; x < width; x += 1) {
      for (let y = boundary - 2; y < boundary; y += 1) {
        const offset = (y * width + x) * 4;
        data.fill(245, offset, offset + 3);
      }
      const boundaryOffset = (boundary * width + x) * 4;
      data.fill(12, boundaryOffset, boundaryOffset + 3);
    }
  }

  const xRanges = [[0, 383], [386, 767], [770, 1149], [1152, width]];
  const yRanges = [[0, 250], [253, 506], [509, 759], [762, height]];
  const expectedFrames = yRanges.flatMap(([top, bottom]) =>
    xRanges.map(([left, right]) => ({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    })),
  );

  return { bitmap: { width, height, data }, expectedFrames };
}

describe('analyzeContactSheetBitmap', () => {
  it('prefers the strongest quarter-grid transitions over weak internal image structures', () => {
    const fixture = createRealisticBoundaryFixture();

    const result = analyzeContactSheetBitmap(fixture.bitmap);
    const minimumWidth = Math.min(...result.frames.map(({ width }) => width)) & ~1;
    const minimumHeight = Math.min(...result.frames.map(({ height }) => height)) & ~1;

    expect(result.frames).toEqual(fixture.expectedFrames);
    expect(result.frames).toHaveLength(16);
    for (const [index, boundary] of [385, 769, 1151].entries()) {
      const previous = result.frames[index];
      const next = result.frames[index + 1];
      expect(previous.x + previous.width).toBeLessThanOrEqual(boundary);
      expect(next.x).toBeGreaterThanOrEqual(boundary);
      expect(next.x - (previous.x + previous.width)).toBeLessThanOrEqual(12);
    }
    for (const [index, boundary] of [252, 508, 761].entries()) {
      const previous = result.frames[index * 4];
      const next = result.frames[(index + 1) * 4];
      expect(previous.y + previous.height).toBeLessThanOrEqual(boundary);
      expect(next.y).toBeGreaterThanOrEqual(boundary);
      expect(next.y - (previous.y + previous.height)).toBeLessThanOrEqual(12);
    }
    for (const [index, frame] of result.frames.entries()) {
      expect(frame.x).toBe(result.frames[index % 4].x);
      expect(frame.y).toBe(result.frames[Math.floor(index / 4) * 4].y);
    }
    expect(result.frames[0].width).not.toBe(334);
    expect(result.frames[1].x).not.toBe(346);
    expect(result.frames[2].x).not.toBe(730);
    expect({ width: minimumWidth, height: minimumHeight }).toEqual({
      width: 378,
      height: 250,
    });
  });

  it.each([1, 2, 3])(
    'detects and removes solid %i-pixel separator bands',
    (separatorWidth) => {
      const fixture = createSheetFixture(
        [20, 20, 20, 20],
        [18, 18, 18, 18],
        [separatorWidth, separatorWidth, separatorWidth],
        [separatorWidth, separatorWidth, separatorWidth],
      );

      expect(analyzeContactSheetBitmap(fixture.bitmap).frames).toEqual(
        fixture.expectedFrames,
      );
    },
  );

  it.each([1, 2, 3])(
    'detects a strong %i-pixel separator between similar flat frame backgrounds',
    (separatorWidth) => {
      const fixture = createSheetFixture(
        [256, 256, 256, 256],
        [256, 256, 256, 256],
        [separatorWidth, separatorWidth, separatorWidth],
        [separatorWidth, separatorWidth, separatorWidth],
      );
      for (const [index, frame] of fixture.expectedFrames.entries()) {
        const column = index % 4;
        for (let y = frame.y; y < frame.y + frame.height; y += 1) {
          for (let x = frame.x; x < frame.x + frame.width; x += 1) {
            const offset = (y * fixture.bitmap.width + x) * 4;
            fixture.bitmap.data.fill(80 + column, offset, offset + 3);
          }
        }
      }

      expect(analyzeContactSheetBitmap(fixture.bitmap).frames).toEqual(
        fixture.expectedFrames,
      );
    },
  );

  it.each([1, 2, 3])(
    'selects the strongest nearby transition on flat backgrounds for a %i-pixel true separator',
    (separatorWidth) => {
      const fixture = createSheetFixture(
        [256, 256, 256, 256],
        [256, 256, 256, 256],
        [separatorWidth, separatorWidth, separatorWidth],
        [separatorWidth, separatorWidth, separatorWidth],
      );
      for (const [index, frame] of fixture.expectedFrames.entries()) {
        const column = index % 4;
        for (let y = frame.y; y < frame.y + frame.height; y += 1) {
          for (let x = frame.x; x < frame.x + frame.width; x += 1) {
            const offset = (y * fixture.bitmap.width + x) * 4;
            fixture.bitmap.data.fill(80 + column, offset, offset + 3);
          }
        }
      }
      for (let y = 0; y < fixture.bitmap.height; y += 1) {
        for (let x = 253; x < 255; x += 1) {
          const offset = (y * fixture.bitmap.width + x) * 4;
          fixture.bitmap.data.fill(245, offset, offset + 3);
        }
      }

      const result = analyzeContactSheetBitmap(fixture.bitmap);

      expect(result.frames).toHaveLength(16);
      expect(result.frames[1].x).toBeGreaterThanOrEqual(253);
      expect(result.frames[1].x).toBeLessThanOrEqual(260);
    },
  );

  it.each([
    ['white/black/white', [245, 0, 245]],
    ['different colors', [220, 80, 170]],
  ] as const)(
    'removes the complete shifted %s separator band on both axes',
    (_name, separatorColors) => {
    const fixture = createSheetFixture(
      [19, 22, 20, 21],
      [17, 21, 19, 20],
      [3, 3, 3],
      [3, 3, 3],
    );
    const verticalStarts = [19, 44, 67];
    const horizontalStarts = [17, 41, 63];

    for (let y = 0; y < fixture.bitmap.height; y += 1) {
      for (const start of verticalStarts) {
        for (let offset = 0; offset < 3; offset += 1) {
          const pixelOffset = (y * fixture.bitmap.width + start + offset) * 4;
          fixture.bitmap.data.fill(
            separatorColors[offset],
            pixelOffset,
            pixelOffset + 3,
          );
        }
      }
    }
    for (const start of horizontalStarts) {
      for (let offset = 0; offset < 3; offset += 1) {
        for (let x = 0; x < fixture.bitmap.width; x += 1) {
          const pixelOffset = ((start + offset) * fixture.bitmap.width + x) * 4;
          fixture.bitmap.data.fill(
            separatorColors[offset],
            pixelOffset,
            pixelOffset + 3,
          );
        }
      }
    }

    const result = analyzeContactSheetBitmap(fixture.bitmap);

    expect(result.frames).toEqual(fixture.expectedFrames);
    for (const frame of result.frames) {
      for (let y = frame.y; y < frame.y + frame.height; y += 1) {
        for (let x = frame.x; x < frame.x + frame.width; x += 1) {
          const offset = (y * fixture.bitmap.width + x) * 4;
          const [blue, green, red] = fixture.bitmap.data.subarray(offset, offset + 3);
          expect(
            blue === green &&
              green === red &&
              separatorColors.some((color) => color === red),
          ).toBe(false);
        }
      }
    }
    },
  );

  it('detects shifted separators with unequal thickness and returns 16 row-major cells', () => {
    const fixture = createSheetFixture();

    const result = analyzeContactSheetBitmap(fixture.bitmap);

    expect(result.frames).toEqual(fixture.expectedFrames);
    expect(result.frames).toHaveLength(16);
  });

  it('keeps uneven cell sizes instead of resizing them', () => {
    const fixture = createSheetFixture(
      [17, 24, 20, 22],
      [23, 18, 25, 19],
      [2, 5, 3],
      [4, 2, 5],
    );

    const result = analyzeContactSheetBitmap(fixture.bitmap);

    expect(result.frames.map(({ width, height }) => [width, height])).toEqual(
      fixture.expectedFrames.map(({ width, height }) => [width, height]),
    );
  });

  it('analyzes a representative 1536x1024 contact sheet fixture', () => {
    const fixture = createSheetFixture(
      [382, 383, 381, 383],
      [254, 253, 255, 255],
      [2, 3, 2],
      [2, 3, 2],
    );

    expect(fixture.bitmap).toMatchObject({ width: 1536, height: 1024 });
    expect(analyzeContactSheetBitmap(fixture.bitmap).frames).toEqual(
      fixture.expectedFrames,
    );
  });

  it('rejects a sheet without detectable separators instead of using equal quarters', () => {
    const width = 80;
    const height = 80;
    const data = Buffer.alloc(width * height * 4, 90);
    for (let offset = 3; offset < data.length; offset += 4) {
      data[offset] = 255;
    }

    expect(() =>
      analyzeContactSheetBitmap({ width, height, data }),
    ).toThrow('4×4 separator');
  });

  it('keeps separator removal local when another band is outside the quarter search region', () => {
    const fixture = createSheetFixture();
    const { width, height, data } = fixture.bitmap;
    for (let y = 0; y < height; y += 1) {
      for (let x = 14; x < 16; x += 1) {
        const offset = (y * width + x) * 4;
        data.fill(245, offset, offset + 3);
        data[offset + 3] = 255;
      }
    }

    const result = analyzeContactSheetBitmap(fixture.bitmap);

    expect(result.frames).toHaveLength(16);
    expect(result.frames[1].x).toBe(23);
  });

  it.each([
    [16, 18],
    [17, 19],
  ] as const)(
    'selects the strongest transition when a band at [%i,%i) is near the true band',
    (start, end) => {
      const fixture = createSheetFixture(
        [20, 22, 19, 21],
        [18, 21, 20, 19],
        [3, 2, 4],
        [2, 4, 3],
      );
      const { width, height, data } = fixture.bitmap;
      for (let y = 0; y < height; y += 1) {
        for (let x = start; x < end; x += 1) {
          const offset = (y * width + x) * 4;
          data.fill(245, offset, offset + 3);
          data[offset + 3] = 255;
        }
      }

      const result = analyzeContactSheetBitmap(fixture.bitmap);

      expect(result.frames).toHaveLength(16);
      expect(result.frames[1].x).toBeGreaterThanOrEqual(18);
      expect(result.frames[1].x).toBeLessThanOrEqual(23);
    },
  );

  it('rejects malformed bitmap data', () => {
    expect(() =>
      analyzeContactSheetBitmap({
        width: 80,
        height: 80,
        data: Buffer.alloc(10),
      }),
    ).toThrow('이미지');
  });
});

describe('analyzeContactSheet', () => {
  it('returns identical physical-pixel rectangles for normal.png and sample@2x.png', () => {
    const fixture = createSheetFixture();
    const encodedBytes = Buffer.from('same-physical-image');
    readFileSync.mockReturnValue(encodedBytes);
    const getSize = vi.fn(() => ({
      width: fixture.bitmap.width,
      height: fixture.bitmap.height,
    }));
    const toBitmap = vi.fn(() => fixture.bitmap.data);
    createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize,
      toBitmap,
    });

    const normal = analyzeContactSheet('C:\\images\\normal.png');
    const at2x = analyzeContactSheet('C:\\images\\sample@2x.png');

    expect(normal.frames).toEqual(fixture.expectedFrames);
    expect(at2x.frames).toEqual(normal.frames);
    expect(createFromBuffer).toHaveBeenCalledTimes(2);
    expect(createFromBuffer).toHaveBeenCalledWith(encodedBytes, { scaleFactor: 1 });
    expect(getSize).toHaveBeenCalledWith(1);
    expect(toBitmap).toHaveBeenCalledWith({ scaleFactor: 1 });
  });

  it('rejects an image nativeImage cannot decode', () => {
    readFileSync.mockReturnValue(Buffer.from('damaged'));
    createFromBuffer.mockReturnValue({
      isEmpty: () => true,
    });

    expect(() => analyzeContactSheet('C:\\images\\damaged.jpg')).toThrow(
      '손상',
    );
  });
});
