import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  exportProject,
  getMalgunGothicPath,
  runFfmpeg,
} from '../../../src/main/export/exportProject';
import { createNewProject } from '../../../src/shared/project/createProject';
import type { ProjectDocument } from '../../../src/shared/project/types';

const runSmoke = process.env.COMBARK_EXPORT_SMOKE === '1';
const configuredFfmpegPath = process.env.COMBARK_SMOKE_FFMPEG || ffmpegPath;

function runFfmpegWithStderr(
  executablePath: string,
  args: string[],
): Promise<string> {
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
        reject(new Error(`FFmpeg audio inspection failed (${code ?? 'unknown'}). ${stderr}`));
      }
    });
  });
}

function readVolume(stderr: string, name: 'mean_volume' | 'max_volume'): number {
  const match = new RegExp(`${name}: (-?\\d+(?:\\.\\d+)?) dB`).exec(stderr);
  if (!match) {
    throw new Error(`FFmpeg did not report ${name}.`);
  }

  return Number(match[1]);
}

function readDurationSeconds(stderr: string): number {
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!match) {
    throw new Error('FFmpeg did not report the output duration.');
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

describe.runIf(runSmoke)('real FFmpeg export smoke', () => {
  let directory: string;
  let imagePath: string;
  let videoPath: string;
  let narrationPath: string;

  beforeAll(async () => {
    if (!configuredFfmpegPath) {
      throw new Error('ffmpeg-static binary is missing');
    }
    directory = process.env.COMBARK_SMOKE_OUTPUT_DIR
      ? process.env.COMBARK_SMOKE_OUTPUT_DIR
      : await mkdtemp(join(tmpdir(), 'combark smoke 한글 '));
    imagePath = join(directory, '입력 이미지.png');
    videoPath = join(directory, '입력 영상.mp4');
    narrationPath = join(directory, '내레이션.wav');
    await runFfmpeg(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360',
      '-frames:v', '1', '-threads', '1', imagePath,
    ]);
    await runFfmpeg(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24',
      '-t', '0.7', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
    ]);
    await runFfmpeg(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.4',
      '-ar', '44100', '-ac', '1', narrationPath,
    ]);
  }, 30_000);

  afterAll(async () => {
    if (directory && !process.env.COMBARK_SMOKE_OUTPUT_DIR) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  function projectWith(
    assets: ProjectDocument['media'],
    scenes: ProjectDocument['scenes'],
    narration: ProjectDocument['narration'] = null,
  ): ProjectDocument {
    return {
      ...createNewProject('실제 내보내기'),
      media: assets,
      scenes,
      narration,
    };
  }

  async function exportAndDecode(project: ProjectDocument, name: string): Promise<string> {
    const outputPath = join(directory, name);
    await exportProject(project, outputPath, {
      ffmpegPath: configuredFfmpegPath as string,
      fontPath: getMalgunGothicPath(),
    });
    expect((await stat(outputPath)).size).toBeGreaterThan(1_000);
    await runFfmpeg(configuredFfmpegPath as string, [
      '-v', 'error', '-i', outputPath, '-f', 'null', 'NUL',
    ]);
    return outputPath;
  }

  it('exports one image with silent AAC and decodes to EOF', async () => {
    await exportAndDecode(projectWith(
      [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: '입력 이미지.png' }],
      [{ mediaId: 'image', durationMs: 500, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
    ), '이미지 결과.mp4');
  }, 30_000);

  it('exports one MP4 to its source EOF and decodes to EOF', async () => {
    await exportAndDecode(projectWith(
      [{ id: 'video', kind: 'video', sourcePath: videoPath, fileName: '입력 영상.mp4' }],
      [{ mediaId: 'video', durationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
    ), '영상 결과.mp4');
  }, 30_000);

  it('exports duplicated scenes from one media asset as two ordered segments', async () => {
    const outputPath = await exportAndDecode(projectWith(
      [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: '입력 이미지.png' }],
      [
        { mediaId: 'image', durationMs: 600, subtitle: 'original', subtitlePosition: 'bottom', subtitleSize: 'medium' },
        { mediaId: 'image', durationMs: 600, subtitle: 'duplicate', subtitlePosition: 'top', subtitleSize: 'large' },
      ],
    ), '복제 장면 결과.mp4');

    const stderr = await runFfmpegWithStderr(configuredFfmpegPath as string, [
      '-hide_banner',
      '-nostdin',
      '-i', outputPath,
      '-f', 'null',
      'NUL',
    ]);
    const durationSeconds = readDurationSeconds(stderr);

    expect(durationSeconds).toBeGreaterThanOrEqual(1.1);
    expect(durationSeconds).toBeLessThanOrEqual(1.3);
  }, 60_000);

  it('exports image, MP4, Korean subtitles, and narration together', async () => {
    const outputPath = await exportAndDecode(projectWith(
      [
        { id: 'image', kind: 'image', sourcePath: imagePath, fileName: '입력 이미지.png' },
        { id: 'video', kind: 'video', sourcePath: videoPath, fileName: '입력 영상.mp4' },
      ],
      [
        { mediaId: 'image', durationMs: 500, subtitle: '첫 장면\n한글 자막 {테스트}', subtitlePosition: 'top', subtitleSize: 'large' },
        { mediaId: 'video', durationMs: null, subtitle: '둘째 장면', subtitlePosition: 'center', subtitleSize: 'small' },
      ],
      { sourcePath: narrationPath, fileName: '내레이션.wav' },
    ), '통합 결과.mp4');

    const stderr = await runFfmpegWithStderr(configuredFfmpegPath as string, [
      '-hide_banner',
      '-nostdin',
      '-i', outputPath,
      '-map', '0:a:0',
      '-vn',
      '-af', 'volumedetect',
      '-f', 'null',
      'NUL',
    ]);

    expect(stderr).toMatch(/Stream #0:\d+.*Audio: aac/);
    expect(readVolume(stderr, 'max_volume')).toBeGreaterThan(-60);
    expect(readVolume(stderr, 'mean_volume')).toBeGreaterThan(-80);
  }, 60_000);
});
