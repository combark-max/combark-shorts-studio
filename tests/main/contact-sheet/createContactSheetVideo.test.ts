import { describe, expect, it, vi } from 'vitest';

const { createFromBuffer, readFileSync } = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  readFileSync: vi.fn((sourcePath: string) => Buffer.from(sourcePath)),
}));

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer },
}));
vi.mock('node:fs', () => ({
  default: { readFileSync },
  readFileSync,
}));

import {
  buildContactSheetFfmpegArgs,
  createContactSheetVideo,
  publishContactSheetOutput,
} from '../../../src/main/contact-sheet/createContactSheetVideo';
import type { ContactSheetSource } from '../../../src/shared/contactSheetVideo';

interface FixtureImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toBitmap(): Buffer;
  crop(rect: { x: number; y: number; width: number; height: number }): {
    toPNG(): Buffer;
  };
}

function createFixtureImage(
  sheetIndex: number,
  cellWidth: number,
  cellHeight: number,
): FixtureImage {
  const separatorWidth = 2;
  const width = cellWidth * 4 + separatorWidth * 3;
  const height = cellHeight * 4 + separatorWidth * 3;
  const data = Buffer.alloc(width * height * 4);
  let y = 0;

  for (let row = 0; row < 4; row += 1) {
    let x = 0;
    for (let column = 0; column < 4; column += 1) {
      const frameIndex = row * 4 + column;
      for (let pixelY = y; pixelY < y + cellHeight; pixelY += 1) {
        for (let pixelX = x; pixelX < x + cellWidth; pixelX += 1) {
          const offset = (pixelY * width + pixelX) * 4;
          data[offset] = 30 + frameIndex * 4;
          data[offset + 1] = 50 + row * 20;
          data[offset + 2] = 70 + column * 20;
          data[offset + 3] = 255;
        }
      }
      x += cellWidth;
      if (column < 3) {
        for (let pixelY = y; pixelY < y + cellHeight; pixelY += 1) {
          for (let pixelX = x; pixelX < x + separatorWidth; pixelX += 1) {
            const offset = (pixelY * width + pixelX) * 4;
            data.fill(245, offset, offset + 3);
            data[offset + 3] = 255;
          }
        }
        x += separatorWidth;
      }
    }
    y += cellHeight;
    if (row < 3) {
      for (let pixelY = y; pixelY < y + separatorWidth; pixelY += 1) {
        for (let pixelX = 0; pixelX < width; pixelX += 1) {
          const offset = (pixelY * width + pixelX) * 4;
          data.fill(245, offset, offset + 3);
          data[offset + 3] = 255;
        }
      }
      y += separatorWidth;
    }
  }

  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toBitmap: () => data,
    crop: (rect) => ({
      toPNG: () => Buffer.from(
        `${sheetIndex}:${rect.x},${rect.y},${rect.width},${rect.height}`,
      ),
    }),
  };
}

function sources(count: number): ContactSheetSource[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `sheet-${index + 1}`,
    sourcePath: `C:\\images\\sheet-${index + 1}.png`,
    fileName: `sheet-${index + 1}.png`,
  }));
}

describe('buildContactSheetFfmpegArgs', () => {
  it.each([8, 10, 12, 16] as const)(
    'uses %i fps only as the image input rate with silent H.264 output',
    (fps) => {
      expect(buildContactSheetFfmpegArgs(
        'C:\\Temp\\frames\\frame-%06d.png',
        48,
        fps,
        'C:\\Temp\\frames\\final.mp4',
      )).toEqual([
        '-y',
        '-framerate', String(fps),
        '-start_number', '0',
        '-i', 'C:\\Temp\\frames\\frame-%06d.png',
        '-frames:v', '48',
        '-an',
        '-c:v', 'libx264',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        'C:\\Temp\\frames\\final.mp4',
      ]);
    },
  );

  it.each([
    ['light', 2, 96],
    ['medium', 3, 144],
    ['strong', 4, 192],
  ] as const)(
    'uses %s interpolation to stretch timestamps by %i and emit %i frames',
    (interpolation, multiplier, outputFrameCount) => {
      expect(buildContactSheetFfmpegArgs(
        'C:\\Temp\\frames\\frame-%06d.png',
        48,
        8,
        'C:\\Temp\\frames\\final.mp4',
        interpolation,
      )).toEqual([
        '-y',
        '-framerate', '8',
        '-start_number', '0',
        '-i', 'C:\\Temp\\frames\\frame-%06d.png',
        '-vf',
        `setpts=${multiplier}*(PTS-STARTPTS),tpad=stop_mode=clone:stop=-1,minterpolate=fps=8:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff:scd_threshold=10,trim=end_frame=${outputFrameCount}`,
        '-frames:v', String(outputFrameCount),
        '-an',
        '-c:v', 'libx264',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        'C:\\Temp\\frames\\final.mp4',
      ]);
    },
  );
});

describe('createContactSheetVideo', () => {
  it.each([null, 2, 'off', 'unexpected'])(
    'rejects invalid interpolation value %j before reading source images',
    async (interpolation) => {
      await expect(createContactSheetVideo(
        {
          sheets: sources(1),
          fps: 8,
          interpolation,
        } as never,
        'C:\\exports\\sequence.mp4',
        { ffmpegPath: 'C:\\tools\\ffmpeg.exe' },
      )).rejects.toThrow('유효하지 않은');

      expect(readFileSync).not.toHaveBeenCalled();
    },
  );

  it.each([
    [1, 16],
    [2, 32],
    [3, 48],
  ] as const)('writes %i sheets as %i globally ordered frames', async (sheetCount, frameCount) => {
    const inputs = sources(sheetCount);
    const images = inputs.map((_source, index) =>
      createFixtureImage(index, 21 - index, 19 - index),
    );
    createFromBuffer.mockImplementation((encoded: Buffer) =>
      images[inputs.findIndex((source) => source.sourcePath === encoded.toString())],
    );
    const writes: Array<[string, string]> = [];
    const runFfmpeg = vi.fn().mockResolvedValue(undefined);
    const copyFile = vi.fn().mockResolvedValue(undefined);
    const renameFile = vi.fn().mockResolvedValue(undefined);
    const pathExists = vi.fn().mockResolvedValue(false);
    const removeDirectory = vi.fn().mockResolvedValue(undefined);

    await createContactSheetVideo(
      { sheets: inputs, fps: 8 },
      'C:\\exports\\sequence.mp4',
      {
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\contact-job'),
        writeFrame: vi.fn(async (path: string, data: Buffer) => {
          writes.push([path, data.toString()]);
        }),
        runFfmpeg,
        copyFile,
        renameFile,
        pathExists,
        makeSiblingPath: (_outputPath, purpose) =>
          `C:\\exports\\sequence.${purpose}.tmp`,
        removeDirectory,
      },
    );

    expect(writes).toHaveLength(frameCount);
    expect(writes[0][0]).toMatch(/frame-000000\.png$/);
    expect(writes.at(-1)?.[0]).toMatch(
      new RegExp(`frame-${String(frameCount - 1).padStart(6, '0')}\\.png$`),
    );
    expect(writes[0][1]).toContain(`0:0,0,${(21 - sheetCount + 1) & ~1},${(19 - sheetCount + 1) & ~1}`);
    if (sheetCount > 1) {
      expect(writes[16][1]).toMatch(/^1:/);
    }
    expect(runFfmpeg).toHaveBeenCalledWith(
      'C:\\tools\\ffmpeg.exe',
      expect.arrayContaining(['-framerate', '8', '-frames:v', String(frameCount), '-an']),
      expect.any(AbortSignal),
    );
    expect(copyFile).toHaveBeenCalledWith(
      'C:\\Temp\\contact-job\\final.mp4',
      'C:\\exports\\sequence.publish.tmp',
    );
    expect(renameFile).toHaveBeenCalledWith(
      'C:\\exports\\sequence.publish.tmp',
      'C:\\exports\\sequence.mp4',
    );
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\contact-job');
  });

  it('cleans temporary frames and preserves output when ffmpeg fails', async () => {
    const input = sources(1);
    createFromBuffer.mockReturnValue(createFixtureImage(0, 20, 20));
    const copyFile = vi.fn();
    const removeDirectory = vi.fn().mockResolvedValue(undefined);

    await expect(createContactSheetVideo(
      { sheets: input, fps: 8, interpolation: 'light' },
      'C:\\exports\\existing.mp4',
      {
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\failed-job'),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        runFfmpeg: vi.fn().mockRejectedValue(new Error('ffmpeg failed')),
        copyFile,
        removeDirectory,
      },
    )).rejects.toThrow('ffmpeg failed');

    expect(copyFile).not.toHaveBeenCalled();
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\failed-job');
  });

  it('stops extraction and cleans temporary frames when canceled', async () => {
    const controller = new AbortController();
    createFromBuffer.mockReturnValue(createFixtureImage(0, 20, 20));
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const copyFile = vi.fn();
    let writeCount = 0;

    await expect(createContactSheetVideo(
      { sheets: sources(1), fps: 8, interpolation: 'medium' },
      'C:\\exports\\canceled.mp4',
      {
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\canceled-job'),
        writeFrame: vi.fn(async () => {
          writeCount += 1;
          controller.abort();
        }),
        runFfmpeg: vi.fn(),
        copyFile,
        removeDirectory,
      },
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(writeCount).toBe(1);
    expect(copyFile).not.toHaveBeenCalled();
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\canceled-job');
  });

  it('keeps the primary FFmpeg failure when temporary cleanup also fails', async () => {
    createFromBuffer.mockReturnValue(createFixtureImage(0, 20, 20));
    const cleanupError = new Error('cleanup failed');
    const onCleanupError = vi.fn();

    await expect(createContactSheetVideo(
      { sheets: sources(1), fps: 8 },
      'C:\\exports\\existing.mp4',
      {
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\failed-cleanup'),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        runFfmpeg: vi.fn().mockRejectedValue(new Error('primary ffmpeg failure')),
        removeDirectory: vi.fn().mockRejectedValue(cleanupError),
        onCleanupError,
      },
    )).rejects.toThrow('primary ffmpeg failure');

    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it('does not turn successful creation into a failure when cleanup fails', async () => {
    createFromBuffer.mockReturnValue(createFixtureImage(0, 20, 20));
    const onCleanupError = vi.fn();

    await expect(createContactSheetVideo(
      { sheets: sources(1), fps: 8 },
      'C:\\exports\\sequence.mp4',
      {
        ffmpegPath: 'C:\\tools\\ffmpeg.exe',
        makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\successful-cleanup'),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        runFfmpeg: vi.fn().mockResolvedValue(undefined),
        copyFile: vi.fn().mockResolvedValue(undefined),
        renameFile: vi.fn().mockResolvedValue(undefined),
        pathExists: vi.fn().mockResolvedValue(false),
        makeSiblingPath: (_outputPath, purpose) =>
          `C:\\exports\\sequence.${purpose}.tmp`,
        removeDirectory: vi.fn().mockRejectedValue(new Error('cleanup failed')),
        onCleanupError,
      },
    )).resolves.toBeUndefined();

    expect(onCleanupError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'cleanup failed',
    }));
  });
});

describe('publishContactSheetOutput', () => {
  const finalPath = 'C:\\Temp\\job\\final.mp4';
  const outputPath = 'C:\\exports\\existing.mp4';
  const siblingPath = 'C:\\exports\\existing.publish.tmp';
  const backupPath = 'C:\\exports\\existing.backup.tmp';

  it('publishes a new file only after the sibling copy completes', async () => {
    const calls: string[] = [];
    const removeFile = vi.fn();

    await publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn(async () => { calls.push('copy-complete'); }),
      renameFile: vi.fn(async () => { calls.push('rename'); }),
      pathExists: vi.fn().mockResolvedValue(false),
      removeFile,
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError: vi.fn(),
    });

    expect(calls).toEqual(['copy-complete', 'rename']);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('replaces an existing output through a backup and cleans the backup', async () => {
    const renameFile = vi.fn().mockResolvedValue(undefined);
    const removeFile = vi.fn().mockResolvedValue(undefined);

    await publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn().mockResolvedValue(undefined),
      renameFile,
      pathExists: vi.fn().mockResolvedValue(true),
      removeFile,
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError: vi.fn(),
    });

    expect(renameFile.mock.calls).toEqual([
      [outputPath, backupPath],
      [siblingPath, outputPath],
    ]);
    expect(removeFile).toHaveBeenCalledWith(backupPath);
  });

  it('leaves an existing output untouched when copying the completed MP4 fails', async () => {
    const renameFile = vi.fn();
    const removeFile = vi.fn().mockResolvedValue(undefined);

    await expect(publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn().mockRejectedValue(new Error('copy failed')),
      renameFile,
      pathExists: vi.fn().mockResolvedValue(true),
      removeFile,
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError: vi.fn(),
    })).rejects.toThrow('copy failed');

    expect(renameFile).not.toHaveBeenCalled();
    expect(removeFile).toHaveBeenCalledWith(siblingPath);
  });

  it('restores an existing output when the final Windows-friendly rename fails', async () => {
    const renameFile = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('replace failed'))
      .mockResolvedValueOnce(undefined);

    await expect(publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn().mockResolvedValue(undefined),
      renameFile,
      pathExists: vi.fn().mockResolvedValue(true),
      removeFile: vi.fn().mockResolvedValue(undefined),
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError: vi.fn(),
    })).rejects.toThrow('replace failed');

    expect(renameFile.mock.calls).toEqual([
      [outputPath, backupPath],
      [siblingPath, outputPath],
      [backupPath, outputPath],
    ]);
  });

  it('preserves the primary copy error when sibling cleanup also fails', async () => {
    const cleanupError = new Error('sibling cleanup failed');
    const onCleanupError = vi.fn();

    await expect(publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn().mockRejectedValue(new Error('primary copy failure')),
      renameFile: vi.fn(),
      pathExists: vi.fn(),
      removeFile: vi.fn().mockRejectedValue(cleanupError),
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError,
    })).rejects.toThrow('primary copy failure');

    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it('cancels after sibling copying without moving an existing output', async () => {
    const controller = new AbortController();
    const renameFile = vi.fn();
    const pathExists = vi.fn().mockResolvedValue(true);
    const removeFile = vi.fn().mockResolvedValue(undefined);

    await expect(publishContactSheetOutput(finalPath, outputPath, {
      copyFile: vi.fn(async () => { controller.abort(); }),
      renameFile,
      pathExists,
      removeFile,
      makeSiblingPath: (_path, purpose) =>
        purpose === 'publish' ? siblingPath : backupPath,
      onCleanupError: vi.fn(),
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(pathExists).not.toHaveBeenCalled();
    expect(renameFile).not.toHaveBeenCalled();
    expect(removeFile).toHaveBeenCalledWith(siblingPath);
  });
});
