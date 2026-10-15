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


function runWithPixels(executablePath: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr)));
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

  it.each([24, 30] as const)('encodes 16 frames at 8fps as %i fps without extending motion', async (fps) => {
    const path = join(directory, 'preserve-' + fps + '.mp4');
    await runContactSheetFfmpeg(configuredFfmpegPath as string,
      buildContactSheetFfmpegArgs(join(directory, 'frame-%06d.png'), 16, 8, path, undefined, fps),
      new AbortController().signal);
    const stderr = await runWithStderr(configuredFfmpegPath as string, [
      '-hide_banner', '-i', path, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', 'NUL',
    ]);
    expect(stderr).toMatch(new RegExp('\\b' + fps + ' fps'));
    expect(stderr).toMatch(/Duration: 00:00:02\.00/);
    const timestamps = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]));
    expect(timestamps).toHaveLength(fps * 2);
    timestamps.forEach((timestamp, index) => expect(timestamp).toBeCloseTo(index / fps, 4));
    expect([...stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]).toBe(String(fps * 2));
    expect(stderr).not.toMatch(/Audio:/);
    expect(stderr).toMatch(/Video: h264/);
    expect(stderr).toMatch(/yuv420p/);
  }, 60_000);

  it.each([
    [10, 24, 38, '01.58'], [12, 24, 32, '01.33'],
    [16, 24, 24, '01.00'], [10, 30, 48, '01.60'],
    [12, 30, 40, '01.33'], [16, 30, 30, '01.00'],
  ] as const)('quantizes 16 frames at %i -> %i fps to %i frames', async (sourceFps, fps, frames, duration) => {
    const path = join(directory, 'quantized-' + sourceFps + '-' + fps + '.mp4');
    await runContactSheetFfmpeg(configuredFfmpegPath as string,
      buildContactSheetFfmpegArgs(join(directory, 'frame-%06d.png'), 16, sourceFps, path, undefined, fps),
      new AbortController().signal);
    const stderr = await runWithStderr(configuredFfmpegPath as string, [
      '-hide_banner', '-i', path, '-map', '0:v:0', '-f', 'null', 'NUL',
    ]);
    expect(stderr).toContain('Duration: 00:00:' + duration);
    expect(stderr).toMatch(new RegExp('\\b' + fps + ' fps'));
    expect([...stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]).toBe(String(frames));
  }, 60_000);

  it.each([24, 30] as const)('retains moving input endpoints at %i fps with terminal padding', async (fps) => {
    const pattern = join(directory, 'motion-' + fps + '-%06d.png');
    await runWithStderr(configuredFfmpegPath as string, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x120:r=8:d=2',
      '-frames:v', '16', '-start_number', '0', '-threads', '1', pattern,
    ]);
    const output = join(directory, 'motion-' + fps + '.mp4');
    await runContactSheetFfmpeg(configuredFfmpegPath as string,
      buildContactSheetFfmpegArgs(pattern, 16, 8, output, undefined, fps), new AbortController().signal);
    const pixels = async (input: string, index: number) => runWithPixels(configuredFfmpegPath as string, [
      '-i', input, '-vf', 'select=eq(n\\,' + index + '),scale=16:16,format=gray',
      '-frames:v', '1', '-threads', '1', '-f', 'rawvideo', 'pipe:1',
    ]);
    const first = await pixels(output, 0);
    const last = await pixels(output, fps * 2 - 1);
    const expectedFirst = await pixels(join(directory, 'motion-' + fps + '-000000.png'), 0);
    const expectedLast = await pixels(join(directory, 'motion-' + fps + '-000015.png'), 0);
    const difference = (a: Buffer, b: Buffer): number => {
      expect(a.length).toBe(256);
      expect(b.length).toBe(256);
      return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    };
    expect(difference(expectedFirst, expectedLast)).toBeGreaterThan(3);
    expect(difference(first, expectedFirst)).toBeLessThan(5);
    expect(difference(last, expectedLast)).toBeLessThan(5);
  }, 60_000);
});
