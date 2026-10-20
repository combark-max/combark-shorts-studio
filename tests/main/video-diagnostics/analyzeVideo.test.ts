import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  analyzeDiagnosticVideo,
  buildMotionEvents,
  buildSceneAndFrameEvents,
  DiagnosticAnalysisError,
  estimateFrameMotion,
  parseFrameAnalysisOutput,
  parseFfmpegProbeOutput,
  parseVidstabAscii,
  probeDiagnosticVideo,
  runFrameAnalysis,
  runFfmpegProcess,
  runMotionAnalysis,
  type SpawnedFfmpegProcess,
} from '../../../src/main/video-diagnostics/analyzeVideo';

const NORMAL_PROBE = String.raw`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\영상\사랑의 꿈.mp4':
  Duration: 00:04:57.23, start: 0.000000, bitrate: 2214 kb/s
  Stream #0:0: Video: h264 (High), yuv420p, 1080x1920, 30 fps, 30 tbr
  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp`;

describe('FFmpeg probe parsing', () => {
  it('parses duration, dimensions, fps, and stream inventory', () => {
    expect(parseFfmpegProbeOutput(NORMAL_PROBE)).toEqual({
      durationMs: 297_230,
      width: 1080,
      height: 1920,
      fps: 30,
      hasVideo: true,
      hasAudio: true,
    });
  });

  it('reports an absent audio stream only when a valid inventory was parsed', () => {
    expect(parseFfmpegProbeOutput(`Input #0, mov, from 'video.mp4':\n  Duration: 00:00:02.00\n  Stream #0:0: Video: h264, 640x360, 25 fps`)).toEqual({
      durationMs: 2_000,
      width: 640,
      height: 360,
      fps: 25,
      hasVideo: true,
      hasAudio: false,
    });
  });

  it('parses audio-only input without inventing video fields', () => {
    expect(parseFfmpegProbeOutput(`Input #0, mov, from 'audio.mp4':\n  Duration: 00:00:03.50\n  Stream #0:0: Audio: aac, 48000 Hz`)).toEqual({
      durationMs: 3_500,
      width: null,
      height: null,
      fps: null,
      hasVideo: false,
      hasAudio: true,
    });
  });

  it('keeps missing duration and fps nullable', () => {
    expect(parseFfmpegProbeOutput(`Input #0, mov, from 'partial.mp4':\n  Stream #0:0: Video: h264, 1920x1080`)).toEqual({
      durationMs: null,
      width: 1920,
      height: 1080,
      fps: null,
      hasVideo: true,
      hasAudio: false,
    });
  });

  it('keeps every field unknown for malformed output', () => {
    expect(parseFfmpegProbeOutput('not valid ffmpeg output')).toEqual({
      durationMs: null,
      width: null,
      height: null,
      fps: null,
      hasVideo: null,
      hasAudio: null,
    });
  });
});

describe('FFmpeg process runner and probe', () => {
  it('uses a short, read-only null-output probe command', async () => {
    const runFfmpeg = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: NORMAL_PROBE,
    });

    await expect(probeDiagnosticVideo('C:\\영상\\사랑의 꿈.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      runFfmpeg,
    })).resolves.toMatchObject({ hasVideo: true, hasAudio: true });

    expect(runFfmpeg).toHaveBeenCalledWith(
      'C:\\tools\\ffmpeg.exe',
      expect.arrayContaining([
        '-hide_banner', '-nostdin', '-i', 'C:\\영상\\사랑의 꿈.mp4',
        '-map', '0:v:0?', '-frames:v', '1', '-map', '0:a:0?', '-frames:a', '1',
        '-f', 'null', '-',
      ]),
      expect.any(Object),
      undefined,
    );
  });

  it.each([
    ['Permission denied', 'file-access'],
    ['Invalid data found when processing input', 'invalid-video'],
  ] as const)('classifies probe failure %s as %s', async (stderr, code) => {
    await expect(probeDiagnosticVideo('C:\\video.mp4', {
      ffmpegPath: 'ffmpeg',
      runFfmpeg: vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr }),
    })).rejects.toMatchObject({ code });
  });

  it('classifies a spawn failure as an FFmpeg start error', async () => {
    await expect(probeDiagnosticVideo('C:\\video.mp4', {
      ffmpegPath: 'missing-ffmpeg',
      runFfmpeg: vi.fn().mockRejectedValue(new DiagnosticAnalysisError(
        'ffmpeg-start',
        'spawn ENOENT',
      )),
    })).rejects.toMatchObject({ code: 'ffmpeg-start' });
  });

  it('kills the child once and rejects with AbortError', async () => {
    const process = fakeProcess();
    const controller = new AbortController();
    const result = runFfmpegProcess('ffmpeg', ['-version'], {
      spawnProcess: () => process.child,
    }, controller.signal);
    controller.abort();
    process.close(null);

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(process.child.kill).toHaveBeenCalledTimes(1);
  });

  it('bounds retained stderr', async () => {
    const process = fakeProcess();
    const result = runFfmpegProcess('ffmpeg', [], {
      spawnProcess: () => process.child,
      maxOutputCharacters: 64,
    });
    process.stderr.emit('data', 'x'.repeat(100));
    process.close(1);

    await expect(result).resolves.toMatchObject({
      code: 1,
      stderr: 'x'.repeat(64),
    });
  });
});

describe('scene, brightness, and frame analysis', () => {
  it('associates frame metadata fields regardless of their order', () => {
    const samples = parseFrameAnalysisOutput([
      'frame:0 pts:0 pts_time:0',
      'lavfi.signalstats.YAVG=50',
      'lavfi.scd.score=2.5',
      'lavfi.scd.mafd=3.5',
      'frame:1 pts:100 pts_time:0.04',
      'lavfi.scd.mafd=22',
      'lavfi.signalstats.YAVG=70',
      'lavfi.scd.score=10',
    ].join('\n'));

    expect(samples).toEqual([
      { timeMs: 0, sceneScore: 2.5, mafd: 3.5, yAverage: 50 },
      { timeMs: 40, sceneScore: 10, mafd: 22, yAverage: 70 },
    ]);
  });

  it('merges repeated metadata-filter headers for the same real FFmpeg frame', () => {
    expect(parseFrameAnalysisOutput([
      'frame:0 pts:0 pts_time:0',
      'lavfi.scd.score=10',
      'frame:0 pts:0 pts_time:0',
      'lavfi.scd.mafd=22',
      'frame:0 pts:0 pts_time:0',
      'lavfi.signalstats.YAVG=40',
      'frame:1 pts:1 pts_time:0.04',
      'lavfi.scd.score=0',
      'frame:1 pts:1 pts_time:0.04',
      'lavfi.scd.mafd=2',
      'frame:1 pts:1 pts_time:0.04',
      'lavfi.signalstats.YAVG=65',
    ].join('\n'))).toEqual([
      { timeMs: 0, sceneScore: 10, mafd: 22, yAverage: 40 },
      { timeMs: 40, sceneScore: 0, mafd: 2, yAverage: 65 },
    ]);
  });

  it('ignores metadata before a timestamp and keeps a valid incomplete final record', () => {
    expect(parseFrameAnalysisOutput([
      'lavfi.scd.score=99',
      'frame:4 pts:400 pts_time:0.4',
      'lavfi.signalstats.YAVG=42',
    ].join('\n'))).toEqual([
      { timeMs: 400, sceneScore: null, mafd: null, yAverage: 42 },
    ]);
  });

  it('uses exact scene and brightness boundaries', () => {
    const events = buildSceneAndFrameEvents([
      { timeMs: 0, sceneScore: 9.99, mafd: 1, yAverage: 50 },
      { timeMs: 1_000, sceneScore: 10, mafd: 1, yAverage: 67.99 },
      { timeMs: 2_000, sceneScore: 0, mafd: 1, yAverage: 85.99 },
    ]);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scene-change', timeMs: 1_000 }),
      expect.objectContaining({ type: 'brightness-change', timeMs: 2_000, scoreMultiple: 1 }),
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'brightness-change', timeMs: 1_000 }),
    ]));
  });

  it('flags a large internal-frame change while ignoring normal MAFD variation', () => {
    const samples = [2, 2.2, 1.9, 2.1, 2, 2.3, 25, 2.1].map((mafd, index) => ({
      timeMs: index * 1_000,
      sceneScore: 0,
      mafd,
      yAverage: 50,
    }));
    const events = buildSceneAndFrameEvents(samples);

    expect(events.filter(({ type }) => type === 'frame-change')).toEqual([
      expect.objectContaining({ timeMs: 6_000 }),
    ]);
  });

  it('suppresses frame and brightness candidates within 500ms of a scene', () => {
    const events = buildSceneAndFrameEvents([
      { timeMs: 0, sceneScore: 0, mafd: 1, yAverage: 10 },
      { timeMs: 1_000, sceneScore: 10, mafd: 30, yAverage: 40 },
      { timeMs: 1_499, sceneScore: 0, mafd: 30, yAverage: 70 },
      { timeMs: 1_501, sceneScore: 0, mafd: 30, yAverage: 100 },
    ]);

    expect(events.some(({ type, timeMs }) => type !== 'scene-change' && timeMs <= 1_500)).toBe(false);
    expect(events.some(({ type, timeMs }) => type === 'brightness-change' && timeMs === 1_501)).toBe(true);
  });

  it('runs pass 1 without audio or output encoding and reports measured progress', async () => {
    const onProgress = vi.fn();
    const runFfmpeg = vi.fn(async (_path, args, callbacks) => {
      callbacks.onStdout?.('out_time_us=1500000\n');
      return {
        code: 0,
        stdout: 'out_time_us=1500000\n',
        stderr: 'frame:0 pts:0 pts_time:0\nlavfi.scd.score=10\n',
      };
    });

    await runFrameAnalysis('C:\\video.mp4', {
      durationMs: 3_000,
      width: 1920,
      height: 1080,
      fps: 30,
      hasVideo: true,
      hasAudio: false,
    }, { ffmpegPath: 'ffmpeg', runFfmpeg, onProgress });

    const args = runFfmpeg.mock.calls[0][1] as string[];
    expect(args.join(' ')).toContain('scdet=threshold=10');
    expect(args.join(' ')).toContain('signalstats');
    expect(args).toEqual(expect.arrayContaining(['-an', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats']));
    expect(args.join(' ')).not.toMatch(/libx264|vidstabtransform/);
    expect(onProgress).toHaveBeenCalledWith({
      stage: 'frame-analysis',
      analyzedMs: 1_500,
      durationMs: 3_000,
      percent: 50,
    });
  });

  it('parses complete streamed frame metadata even when retained stderr contains only its tail', async () => {
    const completeOutput = [
      'frame:0 pts:0 pts_time:0',
      'lavfi.scd.score=12',
      'lavfi.scd.mafd=20',
      'lavfi.signalstats.YAVG=40',
      'x'.repeat(300_000),
      'frame:1 pts:1 pts_time:1',
      'lavfi.scd.score=0',
      'lavfi.scd.mafd=2',
      'lavfi.signalstats.YAVG=42',
    ].join('\n');
    const tailOnly = completeOutput.slice(-256 * 1024);
    const runFfmpeg = vi.fn(async (_path, _args, callbacks) => {
      callbacks.onStderr?.(completeOutput);
      return { code: 0, stdout: '', stderr: tailOnly };
    });

    await expect(runFrameAnalysis('C:\\video.mp4', {
      durationMs: 2_000, width: 1920, height: 1080, fps: 30,
      hasVideo: true, hasAudio: false,
    }, { ffmpegPath: 'ffmpeg', runFfmpeg })).resolves.toEqual([
      expect.objectContaining({ type: 'scene-change', timeMs: 0 }),
    ]);
  });
});

describe('vidstab local-motion analysis', () => {
  const distributedMotions = (dx: number, dy: number) => [
    [dx, dy, 10, 10], [dx, dy, 50, 10], [dx, dy, 90, 10], [dx, dy, 10, 50],
    [dx, dy, 90, 50], [dx, dy, 10, 90], [dx, dy, 50, 90], [dx, dy, 90, 90],
    [dx, dy, 30, 30], [dx, dy, 70, 30], [dx, dy, 30, 70], [dx, dy, 70, 70],
  ].map(([vx, vy, fieldX, fieldY]) => ({
    vx, vy, fieldX, fieldY, fieldSize: 16, contrast: 0.8, match: 0.1,
  }));

  it('parses the actual VID.STAB 1 ASCII frame and LM structure', () => {
    expect(parseVidstabAscii([
      'VID.STAB 1',
      '#      accuracy = 9',
      'Frame 1 (List 2 [(LM 1 -2 10 20 16 0.8 0.1),(LM 1.5 -2.5 30 40 16 0.9 0.2)])',
      'Frame 2 (List 0 [])',
    ].join('\n'))).toEqual([
      {
        frameNumber: 1,
        motions: [
          { vx: 1, vy: -2, fieldX: 10, fieldY: 20, fieldSize: 16, contrast: 0.8, match: 0.1 },
          { vx: 1.5, vy: -2.5, fieldX: 30, fieldY: 40, fieldSize: 16, contrast: 0.9, match: 0.2 },
        ],
      },
      { frameNumber: 2, motions: [] },
    ]);
  });

  it.each([
    'Frame 1 (List 2 [(LM 1 2 10 20 16 0.8 0.1)])',
    'Frame 1 (List 1 [(LM NaN 2 10 20 16 0.8 0.1)])',
    'Frame 1 (List 1 [(LM 1 2 10 20 16 0.8)])',
  ])('rejects malformed or truncated motion records without inventing values', (line) => {
    expect(parseVidstabAscii(`VID.STAB 1\n${line}`)).toEqual([]);
  });

  it('estimates coherent translation from well-distributed local motions', () => {
    const estimate = estimateFrameMotion({ frameNumber: 5, motions: distributedMotions(3, -2) }, { width: 100, height: 100 });
    expect(estimate).toMatchObject({
      frameNumber: 5,
      translationX: 3,
      translationY: -2,
      translationConfidence: 'high',
    });
  });

  it('withholds translation when count or coverage is insufficient', () => {
    const tooFew = estimateFrameMotion({ frameNumber: 1, motions: distributedMotions(1, 1).slice(0, 7) }, { width: 100, height: 100 });
    const poorCoverage = estimateFrameMotion({
      frameNumber: 2,
      motions: distributedMotions(1, 1).map((motion) => ({ ...motion, fieldX: 10, fieldY: 10 })),
    }, { width: 100, height: 100 });

    expect(tooFew.translationX).toBeNull();
    expect(tooFew.uncertaintyCode).toBe('insufficient-motion-data');
    expect(poorCoverage.translationX).toBeNull();
    expect(poorCoverage.uncertaintyCode).toBe('poor-motion-coverage');
  });

  it('absorbs smooth motion but reports a sudden jump and repeated reversals', () => {
    const estimates = [1, 1, 1, 1, 1, 1, 1, 5, -5, 5, -5].map((dx, index) =>
      estimateFrameMotion({ frameNumber: index, motions: distributedMotions(dx, 0) }, { width: 100, height: 100 }));
    const result = buildMotionEvents(estimates, [], 10);

    expect(result.events.some(({ type }) => type === 'motion-jump')).toBe(true);
    expect(result.events.filter(({ type }) => type === 'motion-jitter')).toHaveLength(1);
  });

  it('detects separated accumulated micro-jitter intervals without requiring jump-sized frames', () => {
    const dx = [
      0, 0, 0, 0, 0, 0,
      0.2, -0.2, 0.2, -0.2, 0.2, -0.2, 0.2, -0.2,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0.2, -0.2, 0.2, -0.2, 0.2, -0.2, 0.2, -0.2,
    ];
    const estimates = dx.map((value, index) =>
      estimateFrameMotion({ frameNumber: index, motions: distributedMotions(value, 0) }, { width: 100, height: 100 }));
    const result = buildMotionEvents(estimates, [], 10);

    expect(result.events.filter(({ type }) => type === 'motion-jump')).toEqual([]);
    expect(result.events.filter(({ type }) => type === 'motion-jitter')).toHaveLength(2);
  });

  it('suppresses movement candidates around scene changes', () => {
    const estimates = [1, 1, 1, 1, 1, 1, 1, 10].map((dx, index) =>
      estimateFrameMotion({ frameNumber: index, motions: distributedMotions(dx, 0) }, { width: 100, height: 100 }));
    const result = buildMotionEvents(estimates, [{
      type: 'scene-change', timeMs: 700, scoreMultiple: null, rawScore: 12, confidence: null,
    }], 10);

    expect(result.events).toEqual([]);
  });

  it('gates similarity estimates on count, coverage, inliers, and residual', () => {
    const insufficient = estimateFrameMotion({ frameNumber: 1, motions: distributedMotions(1, 1).slice(0, 11) }, { width: 100, height: 100 });
    expect(insufficient.rotationDegrees).toBeNull();
    expect(insufficient.scalePercent).toBeNull();

    const angle = 1 * Math.PI / 180;
    const scale = 1.02;
    const transformed = distributedMotions(0, 0).map((motion) => ({
      ...motion,
      vx: 2 + (scale * Math.cos(angle) - 1) * motion.fieldX - scale * Math.sin(angle) * motion.fieldY,
      vy: -1 + scale * Math.sin(angle) * motion.fieldX + (scale * Math.cos(angle) - 1) * motion.fieldY,
    }));
    const valid = estimateFrameMotion({ frameNumber: 2, motions: transformed }, { width: 100, height: 100 });
    expect(valid.rotationDegrees).toBeCloseTo(1, 1);
    expect(valid.scalePercent).toBeCloseTo(2, 1);

    const unstable = estimateFrameMotion({
      frameNumber: 3,
      motions: transformed.map((motion, index) => ({
        ...motion,
        vx: motion.vx + (index % 2 === 0 ? 20 : -20),
      })),
    }, { width: 100, height: 100 });
    expect(unstable.rotationDegrees).toBeNull();
    expect(unstable.similarityUncertaintyCode).toBe('unstable-motion-fit');
  });

  it('reports why rotation and scale are unavailable when translation alone is reliable', () => {
    const estimate = estimateFrameMotion({
      frameNumber: 1,
      motions: distributedMotions(1, 1).slice(0, 10),
    }, { width: 100, height: 100 });
    const result = buildMotionEvents([estimate], [], 30);

    expect(estimate.translationX).toBe(1);
    expect(estimate.rotationDegrees).toBeNull();
    expect(result.uncertainties).toEqual([
      expect.objectContaining({ code: 'insufficient-motion-data' }),
    ]);
  });

  it('uses vidstabdetect only and cleans its temporary directory', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const runFfmpeg = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const readTextFile = vi.fn().mockResolvedValue('VID.STAB 1\nFrame 0 (List 0 [])');
    await runMotionAnalysis('C:\\video.mp4', {
      durationMs: 1_000, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true,
    }, {
      ffmpegPath: 'ffmpeg', runFfmpeg,
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-video-diagnostics-one'),
      readTextFile,
      removeDirectory,
    });

    const args = runFfmpeg.mock.calls[0][1].join(' ');
    expect(args).toContain('vidstabdetect=');
    expect(args).toContain('fileformat=ascii');
    expect(args).not.toMatch(/vidstabtransform|libx264/);
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\combark-video-diagnostics-one');
  });

  it.each(['frame', 'motion'] as const)('cleans temporary data when %s analysis fails', async (failureStage) => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const runFfmpeg = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: NORMAL_PROBE })
      .mockResolvedValueOnce(failureStage === 'frame'
        ? { code: 1, stdout: '', stderr: 'failed' }
        : { code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'failed' });

    await expect(analyzeDiagnosticVideo('C:\\video.mp4', {
      ffmpegPath: 'ffmpeg', runFfmpeg,
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-video-diagnostics-failed'),
      readTextFile: vi.fn().mockResolvedValue('VID.STAB 1'),
      removeDirectory,
    })).rejects.toThrow();

    if (failureStage === 'frame') expect(runFfmpeg).toHaveBeenCalledTimes(2);
    expect(removeDirectory).toHaveBeenCalledTimes(failureStage === 'motion' ? 1 : 0);
  });
});

function fakeProcess(): {
  child: SpawnedFfmpegProcess;
  stderr: EventEmitter;
  close(code: number | null): void;
} {
  const child = new EventEmitter() as SpawnedFfmpegProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  Object.assign(child, {
    stdout,
    stderr,
    kill: vi.fn(() => true),
  });
  return {
    child,
    stderr,
    close: (code) => child.emit('close', code),
  };
}
