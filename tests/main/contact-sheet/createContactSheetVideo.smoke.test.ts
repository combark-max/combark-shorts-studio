import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildContactSheetFfmpegArgs,
  runContactSheetFfmpeg,
} from '../../../src/main/contact-sheet/createContactSheetVideo';

const runSmoke = process.env.COMBARK_CONTACT_SHEET_SMOKE === '1';
const configuredFfmpegPath =
  process.env.COMBARK_SMOKE_FFMPEG || ffmpegPath;

function runWithStderr(executablePath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stderr);
      } else {
        reject(new Error(`FFmpeg smoke command failed (${code ?? 'unknown'}). ${stderr}`));
      }
    });
  });
}

describe.runIf(runSmoke)('real contact-sheet FFmpeg smoke', () => {
  let directory: string;
  let outputPath: string;

  beforeAll(async () => {
    if (!configuredFfmpegPath) {
      throw new Error('ffmpeg-static binary is missing');
    }
    directory = await mkdtemp(join(tmpdir(), 'combark-contact-sheet-smoke-'));
    const sourceFrame = join(directory, 'source.png');
    await runWithStderr(configuredFfmpegPath, [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=320x240',
      '-frames:v', '1',
      '-threads', '1',
      sourceFrame,
    ]);
    for (let index = 0; index < 48; index += 1) {
      await copyFile(
        sourceFrame,
        join(directory, `frame-${index.toString().padStart(6, '0')}.png`),
      );
    }
    outputPath = join(directory, 'sequence.mp4');
  }, 30_000);

  afterAll(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('encodes exactly 48 silent H.264 yuv420p frames at 8fps', async () => {
    const controller = new AbortController();
    await runContactSheetFfmpeg(
      configuredFfmpegPath as string,
      buildContactSheetFfmpegArgs(
        join(directory, 'frame-%06d.png'),
        48,
        8,
        outputPath,
      ),
      controller.signal,
    );
    expect((await stat(outputPath)).size).toBeGreaterThan(1_000);

    const stderr = await runWithStderr(configuredFfmpegPath as string, [
      '-hide_banner',
      '-i', outputPath,
      '-map', '0:v:0',
      '-f', 'null',
      'NUL',
    ]);
    expect(stderr).toMatch(/Video: h264/);
    expect(stderr).toMatch(/yuv420p/);
    expect(stderr).not.toMatch(/Audio:/);
    expect(stderr).toMatch(/Duration: 00:00:06\.00/);
    const decodedFrameCounts = [...stderr.matchAll(/frame=\s*(\d+)/g)];
    expect(decodedFrameCounts.at(-1)?.[1]).toBe('48');
  }, 60_000);

  it.each([
    ['light', 32, '04'],
    ['medium', 48, '06'],
    ['strong', 64, '08'],
  ] as const)(
    'encodes %s interpolation as %i silent frames with the expected duration',
    async (interpolation, frameCount, durationSeconds) => {
      const interpolatedOutputPath = join(
        directory,
        `sequence-${interpolation}.mp4`,
      );
      await runContactSheetFfmpeg(
        configuredFfmpegPath as string,
        buildContactSheetFfmpegArgs(
          join(directory, 'frame-%06d.png'),
          16,
          8,
          interpolatedOutputPath,
          interpolation,
        ),
        new AbortController().signal,
      );

      const stderr = await runWithStderr(configuredFfmpegPath as string, [
        '-hide_banner',
        '-i', interpolatedOutputPath,
        '-map', '0:v:0',
        '-f', 'null',
        'NUL',
      ]);
      expect(stderr).toMatch(/Video: h264/);
      expect(stderr).toMatch(/yuv420p/);
      expect(stderr).not.toMatch(/Audio:/);
      expect(stderr).toMatch(
        new RegExp(`Duration: 00:00:${durationSeconds}\\.00`),
      );
      const decodedFrameCounts = [...stderr.matchAll(/frame=\s*(\d+)/g)];
      expect(decodedFrameCounts.at(-1)?.[1]).toBe(String(frameCount));
    },
    60_000,
  );
});
