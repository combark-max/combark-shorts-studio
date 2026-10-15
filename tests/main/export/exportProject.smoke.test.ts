import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  exportProject,
  getMalgunGothicPath,
} from '../../../src/main/export/exportProject';
import { createNewProject } from '../../../src/shared/project/createProject';
import type { ProjectDocument } from '../../../src/shared/project/types';

const runSmoke = process.env.COMBARK_EXPORT_SMOKE === '1';
const configuredFfmpegPath = process.env.COMBARK_SMOKE_FFMPEG || ffmpegPath;

class SmokeFfmpegScope {
  private stopped = false;
  private children = new Map<ChildProcess, Promise<void>>();
  private pending = new Set<Promise<unknown>>();

  constructor(private cleanupTimeoutMs = 5_000) {}

  get livePids(): number[] {
    return [...this.children.keys()].map((child) => child.pid);
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    // Observe settlement for cleanup without changing the caller's rejection.
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }

  run(executablePath: string, args: string[], onStderr?: (chunk: string) => void): Promise<string> {
    if (this.stopped) return Promise.reject(new Error('FFmpeg smoke scope stopped'));
    const operation = new Promise<string>((resolve, reject) => {
      const child = spawn(executablePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let closed: () => void;
      this.children.set(child, new Promise<void>((done) => { closed = done; }));
      let stderr = '';
      let spawnError: Error | undefined;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-1_048_576);
        onStderr?.(chunk);
      });
      child.on('error', (error) => { spawnError = error; });
      child.on('close', (code) => {
        this.children.delete(child);
        closed();
        if (spawnError) reject(spawnError);
        else if (this.stopped) reject(new Error('FFmpeg smoke scope stopped'));
        else if (code === 0) resolve(stderr);
        else reject(new Error('FFmpeg smoke failed (' + (code ?? 'unknown') + '). ' + stderr.slice(-16_384)));
      });
    });
    return this.track(operation);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const child of this.children.keys()) child.kill('SIGKILL');
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        // Rejected commands remain rejected to their callers; here we wait for
        // close and exportProject's finally block before deleting any inputs.
        Promise.allSettled([...this.pending, ...this.children.values()]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('FFmpeg cleanup deadline exceeded; inputs retained')), this.cleanupTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

const smokeScopes = new Set<SmokeFfmpegScope>();

function createSmokeScope(cleanupTimeoutMs = 5_000): SmokeFfmpegScope {
  const scope = new SmokeFfmpegScope(cleanupTimeoutMs);
  smokeScopes.add(scope);
  return scope;
}

async function stopSmokeScopes(): Promise<void> {
  const results = await Promise.allSettled([...smokeScopes].map(async (scope) => {
    await scope.stop();
    smokeScopes.delete(scope); // Keep any scope whose close/finally deadline failed.
  }));
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}

async function removeSmokeInputs(directory: string): Promise<void> {
  await stopSmokeScopes();
  await rm(directory, { recursive: true, force: true });
}

let smokeScope = createSmokeScope();
// These hooks also cover local scopes in the process-cleanup regression tests.
afterEach(stopSmokeScopes);
afterAll(stopSmokeScopes);

function runFfmpegWithStderr(executablePath: string, args: string[]): Promise<string> {
  return smokeScope.run(executablePath, args);
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
  let probeJobDirectory: string;

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
    await runFfmpegWithStderr(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360',
      '-frames:v', '1', '-threads', '1', imagePath,
    ]);
    await runFfmpegWithStderr(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24',
      '-t', '0.7', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
    ]);
    await runFfmpegWithStderr(configuredFfmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.4',
      '-ar', '44100', '-ac', '1', narrationPath,
    ]);
  }, 30_000);

  beforeEach(async () => {
    await stopSmokeScopes();
    smokeScope = createSmokeScope();
  });
  afterEach(async () => {
    await stopSmokeScopes();
    if (process.env.COMBARK_EXPORT_LIFECYCLE_PROBE) {
      if (probeJobDirectory) await expect(stat(probeJobDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      console.info('FFMPEG_LIFECYCLE_CLOSED', JSON.stringify({ pids: smokeScope.livePids, jobRemoved: true }));
    }
  });

  afterAll(async () => {
    await stopSmokeScopes();
    if (directory && !process.env.COMBARK_SMOKE_OUTPUT_DIR) {
      await removeSmokeInputs(directory);
      if (process.env.COMBARK_EXPORT_LIFECYCLE_PROBE) console.info('FFMPEG_LIFECYCLE_INPUTS_REMOVED', directory);
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
    const scope = smokeScope;
    return scope.track((async () => {
      await exportProject(project, outputPath, {
        ffmpegPath: configuredFfmpegPath as string,
        fontPath: getMalgunGothicPath(),
        runFfmpeg: async (executable, args) => { await scope.run(executable, args); },
      });
      expect((await stat(outputPath)).size).toBeGreaterThan(1_000);
      await scope.run(configuredFfmpegPath as string, [
        '-v', 'error', '-i', outputPath, '-f', 'null', 'NUL',
      ]);
      return outputPath;
    })());
  }

  it('exports one image with silent AAC and decodes to EOF', async () => {
    await exportAndDecode(projectWith(
      [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: '입력 이미지.png' }],
      [{ mediaId: 'image', durationMs: 500, playbackDurationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
    ), '이미지 결과.mp4');
  }, 30_000);

  it('exports one MP4 to its source EOF and decodes to EOF', async () => {
    await exportAndDecode(projectWith(
      [{ id: 'video', kind: 'video', sourcePath: videoPath, fileName: '입력 영상.mp4' }],
      [{ mediaId: 'video', durationMs: null, playbackDurationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
    ), '영상 결과.mp4');
  }, 30_000);

  it('loops one MP4 to an exact explicit playback duration', async () => {
    const outputPath = await exportAndDecode(projectWith(
      [{ id: 'video', kind: 'video', sourcePath: videoPath, fileName: 'loop.mp4' }],
      [{ mediaId: 'video', durationMs: null, playbackDurationMs: 1800, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
    ), 'looped-video.mp4');

    const stderr = await runFfmpegWithStderr(configuredFfmpegPath as string, [
      '-hide_banner', '-i', outputPath, '-f', 'null', 'NUL',
    ]);
    const durationSeconds = readDurationSeconds(stderr);

    expect(durationSeconds).toBeGreaterThanOrEqual(1.75);
    expect(durationSeconds).toBeLessThanOrEqual(1.9);
  }, 60_000);

  it('exports duplicated scenes from one media asset as two ordered segments', async () => {
    const outputPath = await exportAndDecode(projectWith(
      [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: '입력 이미지.png' }],
      [
        { mediaId: 'image', durationMs: 600, playbackDurationMs: null, subtitle: 'original', subtitlePosition: 'bottom', subtitleSize: 'medium' },
        { mediaId: 'image', durationMs: 600, playbackDurationMs: null, subtitle: 'duplicate', subtitlePosition: 'top', subtitleSize: 'large' },
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
        { mediaId: 'image', durationMs: 500, playbackDurationMs: null, subtitle: '첫 장면\n한글 자막 {테스트}', subtitlePosition: 'top', subtitleSize: 'large' },
        { mediaId: 'video', durationMs: null, playbackDurationMs: null, subtitle: '둘째 장면', subtitlePosition: 'center', subtitleSize: 'small' },
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

  it.runIf(process.platform === 'win32')('keeps Korean subtitle pixels and Malgun Gothic selection identical to the legacy font path', async () => {
    const scope = smokeScope;
    const project = projectWith(
      [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: 'input.png' }],
      [{ mediaId: 'image', durationMs: 200, playbackDurationMs: null, subtitle: '첫 장면\n한글 자막 {테스트} [괄호] \\ 경로', subtitlePosition: 'top', subtitleSize: 'large' }],
    );
    await scope.track(exportProject(project, join(directory, 'font-compatibility.mp4'), {
      ffmpegPath: configuredFfmpegPath as string,
      fontPath: getMalgunGothicPath(),
      runFfmpeg: async (executable, args) => {
        const filterIndex = args.indexOf('-vf');
        if (filterIndex < 0) { await scope.run(executable, args); return; }
        expect(args[filterIndex + 1]).not.toContain(':fontsdir=');
        const start = Date.now();
        const actualLog = await scope.run(executable, ['-loglevel', 'verbose', ...args]);
        const improvedMs = Date.now() - start;
        const legacy = [...args];
        // Keep the passing regression independent of the original whole-directory
        // bottleneck. The opt-in benchmark compares that exact original path.
        let fontsDirectory = getMalgunGothicPath().replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        if (process.env.COMBARK_EXPORT_FONT_BENCHMARK !== '1') {
          fontsDirectory = join(directory, 'legacy-fonts');
          await mkdir(fontsDirectory, { recursive: true });
          await copyFile(getMalgunGothicPath(), join(fontsDirectory, 'malgun.ttf'));
        }
        const fonts = fontsDirectory.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/([,;[\]])/g, '\\$1');
        legacy[filterIndex + 1] += ":fontsdir='" + fonts + "'";
        legacy[legacy.length - 1] = join(directory, 'font-legacy.mp4');
        const legacyStart = Date.now();
        const legacyLog = await scope.run(executable, ['-loglevel', 'verbose', ...legacy]);
        const legacyMs = Date.now() - legacyStart;
        const plain = [...args];
        plain[filterIndex + 1] = plain[filterIndex + 1].split(',ass=')[0];
        plain[plain.length - 1] = join(directory, 'font-no-subtitles.mp4');
        await scope.run(executable, plain);
        const hashes = async (video: string, name: string): Promise<string[]> => {
          const target = join(directory, name + '.framemd5');
          await scope.run(executable, ['-y', '-i', video, '-map', '0:v:0', '-f', 'framemd5', target]);
          return (await readFile(target, 'utf8')).split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
        };
        const actual = await hashes(args[args.length - 1], 'actual');
        const expected = await hashes(legacy[legacy.length - 1], 'legacy');
        const withoutSubtitles = await hashes(plain[plain.length - 1], 'plain');
        expect(actual).toHaveLength(6);
        expect(actual).toEqual(expected);
        expect(actual).not.toEqual(withoutSubtitles);
        expect(actualLog).toMatch(/Using font provider directwrite/i);
        expect(actualLog).toMatch(/fontselect: \(Malgun Gothic,.*MalgunGothic/);
        expect(actualLog).not.toContain('Loading font file');
        expect(legacyLog).toContain('Loading font file');
        console.info('FONT_COMPATIBILITY', JSON.stringify({ improvedMs, legacyMs, legacySystemDirectory: process.env.COMBARK_EXPORT_FONT_BENCHMARK === '1', identicalFrames: actual.length }));
      },
    }));
  }, 60_000);

  // Opt-in negative probes: they must fail normally, then the hooks must still
  // close FFmpeg before deleting inputs. Never enabled in the passing suite.
  if (process.env.COMBARK_EXPORT_LIFECYCLE_PROBE) {
    it('intentional lifecycle probe', async () => {
      let ready: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const scope = smokeScope;
      const operation = scope.track(exportProject(projectWith(
        [{ id: 'image', kind: 'image', sourcePath: imagePath, fileName: 'input.png' }],
        [{ mediaId: 'image', durationMs: 200, playbackDurationMs: null, subtitle: 'probe', subtitlePosition: 'bottom', subtitleSize: 'medium' }],
      ), join(directory, 'probe-output.mp4'), {
        ffmpegPath: configuredFfmpegPath as string,
        fontPath: getMalgunGothicPath(),
        makeTempDirectory: async () => {
          probeJobDirectory = await mkdtemp(join(directory, 'probe-job-'));
          return probeJobDirectory;
        },
        runFfmpeg: async (executable) => {
          await scope.run(executable, [
            '-re', '-loop', '1', '-i', imagePath, '-f', 'null', 'NUL',
          ], (chunk) => { if (chunk.includes('Input #0')) ready(); });
        },
      }));
      await started;
      console.info('FFMPEG_LIFECYCLE_STARTED', JSON.stringify({ pids: smokeScope.livePids, directory }));
      if (process.env.COMBARK_EXPORT_LIFECYCLE_PROBE === 'failure') throw new Error('Intentional lifecycle failure');
      await operation; // Intentionally exceeds the unchanged 60 second limit.
    }, 60_000);
  }
});

describe('subtitle font directory compatibility', () => {
  it.each([
    ['win32', 'system', false],
    ['linux', 'system', true],
    ['win32', 'custom', true],
  ] as const)('preserves font resolution on %s with %s fonts', async (platform, kind, includesDirectory) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const calls: string[][] = [];
    const originalFont = getMalgunGothicPath();
    try {
      Object.defineProperty(process, 'platform', { value: platform });
      const project: ProjectDocument = {
        ...createNewProject('font test'),
        media: [{ id: 'image', kind: 'image', sourcePath: 'C:\\media\\image.png', fileName: 'image.png' }],
        scenes: [{ mediaId: 'image', durationMs: 600, playbackDurationMs: null, subtitle: '한글 {자막}', subtitlePosition: 'top', subtitleSize: 'large' }],
      };
      await exportProject(project, 'C:\\exports\\out.mp4', {
        ffmpegPath: 'ffmpeg', fontPath: kind === 'system' ? originalFont : 'C:\\custom-fonts\\malgun.ttf',
        pathExists: async () => true, makeTempDirectory: async () => 'C:\\Temp\\font-test',
        writeTextFile: async () => undefined, copyFile: async () => undefined, removeDirectory: async () => undefined,
        runFfmpeg: async (_executable, args) => { calls.push(args); },
      });
      const filter = calls[0][calls[0].indexOf('-vf') + 1];
      expect(filter).toContain('ass=filename=');
      expect(filter.includes(':fontsdir=')).toBe(includesDirectory);
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  });
});

describe.runIf(runSmoke)('FFmpeg process cleanup', () => {
  it('waits for close and export cleanup before allowing input deletion', async () => {
    const scope = createSmokeScope();
    const directory = await mkdtemp(join(tmpdir(), 'combark-process-cleanup-'));
    const image = join(directory, 'input.png');
    let cleaned = false;
    try {
      await scope.run(configuredFfmpegPath as string, [
        '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64',
        '-frames:v', '1', '-threads', '1', image,
      ]);
      let ready: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const operation = scope.run(configuredFfmpegPath as string, [
        '-re', '-loop', '1', '-i', image, '-f', 'null', 'NUL',
      ], (chunk) => { if (chunk.includes('Input #0')) ready(); });
      const job = scope.track(operation.finally(async () => {
        await rm(directory, { recursive: true, force: true });
        cleaned = true;
      }));
      const failure = expect(job).rejects.toThrow('stopped');
      await started;
      expect(scope.livePids.length).toBe(1);
      await scope.stop();
      await failure;
      expect(scope.livePids).toEqual([]);
      expect(cleaned).toBe(true);
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(scope.run(configuredFfmpegPath as string, ['-version'])).rejects.toThrow('stopped');
    } finally {
      await scope.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('reports a real FFmpeg failure and leaves no live process', async () => {
    const scope = createSmokeScope();
    try {
      await expect(scope.run(configuredFfmpegPath as string, [
        '-i', join(tmpdir(), 'combark-intentionally-missing-input', 'missing.mp4'),
        '-f', 'null', 'NUL',
      ])).rejects.toThrow(/FFmpeg smoke failed \([1-9]\d*\)/);
      expect(scope.livePids).toEqual([]);
    } finally {
      await scope.stop();
    }
  }, 60_000);

  it('fails bounded cleanup instead of waiting forever for an unfinished export', async () => {
    const scope = new SmokeFfmpegScope(50);
    scope.track(new Promise<void>(() => undefined));
    await expect(scope.stop()).rejects.toThrow('cleanup deadline');
  }, 60_000);
});

describe.runIf(runSmoke)('cleanup deadline input protection', () => {
  it('keeps inputs when an earlier scope has not drained, even after a new scope exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'combark-retained-input-'));
    let finish: () => void;
    const earlier = createSmokeScope(50);
    earlier.track(new Promise<void>((resolve) => { finish = resolve; }));
    createSmokeScope();
    try {
      await expect(removeSmokeInputs(directory)).rejects.toThrow('cleanup deadline');
      expect((await stat(directory)).isDirectory()).toBe(true);
    } finally {
      finish();
      await removeSmokeInputs(directory);
    }
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);
});
