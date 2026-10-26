import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';

import { correctFinalVideo } from '../../../src/main/video-final-correction/correctFinalVideo';
import type { VideoFinalCorrectionMethod } from '../../../src/shared/videoFinalCorrection';

const sourcePath = process.env.COMBARK_FINAL_CORRECTION_SOURCE;
const outputPath = process.env.COMBARK_FINAL_CORRECTION_OUTPUT;
const method = (process.env.COMBARK_FINAL_CORRECTION_METHOD ?? 'basic') as VideoFinalCorrectionMethod;
const runCorrection = process.env.COMBARK_FINAL_CORRECTION_SMOKE === '1';
const runCancellation = process.env.COMBARK_FINAL_CORRECTION_CANCEL_SMOKE === '1';
const configuredFfmpegPath = process.env.COMBARK_SMOKE_FFMPEG || ffmpegPath;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function requirePaths(): { source: string; output: string } {
  if (!sourcePath || !outputPath) {
    throw new Error('COMBARK_FINAL_CORRECTION_SOURCE and COMBARK_FINAL_CORRECTION_OUTPUT are required');
  }
  if (!configuredFfmpegPath) throw new Error('ffmpeg-static binary is missing');
  return { source: sourcePath, output: outputPath };
}

describe.runIf(runCorrection)('real final-correction FFmpeg smoke', () => {
  it('corrects and verifies an entire MP4 without changing the source', async () => {
    const paths = requirePaths();
    expect(await exists(paths.output)).toBe(false);
    const sourceHash = await sha256(paths.source);

    const result = await correctFinalVideo({
      sourcePath: paths.source,
      outputPath: paths.output,
      method,
    }, { ffmpegPath: configuredFfmpegPath });

    expect(await exists(paths.output)).toBe(true);
    expect(await sha256(paths.source)).toBe(sourceHash);
    expect(result).toMatchObject({
      sourcePath: paths.source,
      outputPath: paths.output,
      method,
      width: 1080,
      height: 1920,
      fps: 30,
      audioStreamCount: 1,
    });
    expect(result.frameCount).toBeGreaterThan(0);
  }, 30 * 60 * 1_000);
});

describe.runIf(runCancellation)('real final-correction cancellation smoke', () => {
  it('stops a running FFmpeg job and removes temporary output', async () => {
    const paths = requirePaths();
    expect(await exists(paths.output)).toBe(false);
    const sourceHash = await sha256(paths.source);
    const controller = new AbortController();

    await expect(correctFinalVideo({
      sourcePath: paths.source,
      outputPath: paths.output,
      method: 'basic',
    }, {
      ffmpegPath: configuredFfmpegPath,
      onProgress: (progress) => {
        if (progress.stage === 'detecting' && (progress.processedFrames ?? 0) >= 30) {
          controller.abort();
        }
      },
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(await exists(paths.output)).toBe(false);
    expect(await sha256(paths.source)).toBe(sourceHash);
    const pendingPrefix = `.${basename(paths.output, '.mp4')}.`;
    const siblings = await readdir(dirname(paths.output));
    expect(siblings.filter((name) => name.startsWith(pendingPrefix) && name.endsWith('.partial.mp4'))).toEqual([]);
  }, 10 * 60 * 1_000);
});
