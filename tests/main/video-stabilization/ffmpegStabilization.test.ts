import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  assertTransformRecordCount,
  buildConstantFrameRateCheckArgs,
  buildVidstabDetectArgs,
  buildVidstabTransformArgs,
  assertConstantFrameRate,
  parseFfmpegFrameProgress,
  runStabilizationProcess,
  StabilizationProcessError,
  type SpawnedStabilizationProcess,
  type StabilizationInputWindow,
  type StabilizationPreset,
} from '../../../src/main/video-stabilization/ffmpegStabilization';

const window: StabilizationInputWindow = {
  sourcePath: 'C:\\영상\\sample.mp4',
  startFrame: 135,
  frameCount: 180,
  fps: 30,
  width: 1_080,
  height: 1_920,
};

const preset: StabilizationPreset = {
  strength: 'weak',
  detect: { shakiness: 5, accuracy: 9, stepsize: 12, mincontrast: 0.25 },
  transform: {
    smoothing: 8,
    interpol: 'bicubic',
    maxshift: 24,
    maxangleRadians: 0.03,
  },
};

describe('vidstab command construction', () => {
  it('builds an exact-frame full-resolution detect pass', () => {
    const args = buildVidstabDetectArgs({
      window,
      transformPath: 'C:\\Temp\\one,job\\motions.trf',
      preset,
    });
    expect(args).toEqual(expect.arrayContaining([
      '-nostdin', '-ss', '4.5', '-i', window.sourcePath,
      '-map', '0:v:0', '-frames:v', '180', '-an', '-f', 'null',
      '-progress', 'pipe:1', '-',
    ]));
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain('format=yuv420p,trim=end_frame=180,setpts=PTS-STARTPTS,vfrdet,vidstabdetect=');
    expect(filter).toContain('fileformat=ascii');
    expect(filter).toContain("result='C\\:/Temp/one\\,job/motions.trf'");
    expect(args.join(' ')).not.toMatch(/(?:^|\s)(?:-r|fps|select|mpdecimate|minterpolate)(?:=|\s)/);
  });

  it.each([1, 2, 3] as const)('uses a fixed %i%% zoom with dynamic zoom disabled', (zoomPercent) => {
    const args = buildVidstabTransformArgs({
      window,
      transformPath: 'C:\\Temp\\motions.trf',
      outputPath: 'C:\\Temp\\preview.mp4',
      preset,
      strength: 'weak',
      zoomPercent,
      encoder: 'libx264',
      includeAudio: true,
      correctionStartOffsetFrames: 15,
      correctionEndOffsetFramesExclusive: 165,
      previewStartOffsetFrames: 0,
      previewEndOffsetFramesExclusive: 180,
    });
    expect(args.slice(0, 7)).toEqual([
      '-y', '-hide_banner', '-nostdin', '-ss', '4.5', '-i', window.sourcePath,
    ]);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('vidstabtransform=');
    expect(graph).toContain('[0:v:0]');
    expect(graph).toContain('tripod=0');
    expect(graph).toContain('optzoom=0');
    expect(graph).toContain(`zoom=${zoomPercent}`);
    expect(graph).toContain('crop=black');
    expect(graph).toContain('smoothing=8');
    expect(graph.indexOf('vidstabtransform=')).toBeLessThan(graph.indexOf('trim=start_frame=15'));
    expect(graph).toContain('concat=n=3:v=1:a=0');
    expect(args).toEqual(expect.arrayContaining([
      '-map', '[vout]', '-frames:v', '180', '-c:v', 'libx264',
      '-c:a', 'aac', '-movflags', '+faststart',
    ]));
  });

  it('uses the same immutable seek, input, and frame window in both passes', () => {
    const detect = buildVidstabDetectArgs({ window, transformPath: 'C:\\m.trf', preset });
    const transform = buildVidstabTransformArgs({
      window, transformPath: 'C:\\m.trf', outputPath: 'C:\\out.mp4', preset,
      strength: 'weak', zoomPercent: 2, encoder: 'libx264', includeAudio: false,
      correctionStartOffsetFrames: 0, correctionEndOffsetFramesExclusive: 180,
      previewStartOffsetFrames: 0, previewEndOffsetFramesExclusive: 180,
    });
    for (const token of ['-ss', '-i']) {
      expect(transform[transform.indexOf(token) + 1]).toBe(detect[detect.indexOf(token) + 1]);
    }
    expect(transform).toEqual(expect.arrayContaining(['-frames:v', '180']));
  });

  it('rejects VFR or missing vfrdet evidence before transform', () => {
    expect(() => assertConstantFrameRate('[Parsed_vfrdet_0] VFR:0.000000 (0/179)')).not.toThrow();
    expect(() => assertConstantFrameRate('[Parsed_vfrdet_0] VFR:0.100000 (18/161)')).toThrow('가변');
    expect(() => assertConstantFrameRate('no vfr result')).toThrow('확인');
  });

  it('checks frame cadence across the complete source without a cutoff artifact', () => {
    const args = buildConstantFrameRateCheckArgs(window);
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-frames:v');
    expect(args).toEqual(expect.arrayContaining(['-i', window.sourcePath]));
    expect(args[args.indexOf('-vf') + 1]).toBe('format=yuv420p,vfrdet');
  });

  it('keeps off as a re-encoded control without vidstab or zoom', () => {
    const args = buildVidstabTransformArgs({
      window, outputPath: 'C:\\out.mp4', strength: 'off', zoomPercent: 3,
      encoder: 'h264_qsv', includeAudio: false,
      correctionStartOffsetFrames: 15, correctionEndOffsetFramesExclusive: 165,
      previewStartOffsetFrames: 0, previewEndOffsetFramesExclusive: 180,
    });
    expect(args.join(' ')).not.toMatch(/vidstab|optzoom|zoom=/);
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'h264_qsv', '-frames:v', '180']));
  });
});

describe('stabilization process safety', () => {
  it.each([
    ['frame=17', 17],
    ['frame=  203\nfps=30', 203],
    ['progress=continue', null],
  ])('parses frame progress from %j', (text, expected) => {
    expect(parseFfmpegFrameProgress(text)).toBe(expected);
  });

  it('rejects transform count mismatch before transform execution', () => {
    expect(() => assertTransformRecordCount(
      'VID.STAB 1\nFrame 0 (List 0 [])\nFrame 1 (List 0 [])',
      3,
    )).toThrow('프레임 수');
    expect(() => assertTransformRecordCount(
      'VID.STAB 1\nFrame 0 (List 0 [])\nFrame 1 (List 0 [])',
      2,
    )).not.toThrow();
  });

  it('bounds output, reports progress, and rejects FFmpeg failures', async () => {
    const process = fakeProcess();
    const onProgressFrame = vi.fn();
    const pending = runStabilizationProcess('ffmpeg', ['-i', 'in'], {
      spawnProcess: () => process.child,
      maxOutputCharacters: 12,
      onProgressFrame,
    });
    process.stdout.emit('data', 'frame=7\n');
    process.stderr.emit('data', 'not enough transforms and more text');
    process.close(1);
    await expect(pending).rejects.toMatchObject({
      name: 'StabilizationProcessError',
      code: 'insufficient-transforms',
    });
    expect(onProgressFrame).toHaveBeenCalledWith(7);
  });

  it('kills the child exactly once when aborted', async () => {
    const process = fakeProcess();
    const controller = new AbortController();
    const pending = runStabilizationProcess('ffmpeg', [], {
      spawnProcess: () => process.child,
    }, controller.signal);
    controller.abort();
    controller.abort();
    expect(process.child.kill).toHaveBeenCalledTimes(1);
    process.close(null);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('classifies an ordinary non-zero exit separately', async () => {
    const process = fakeProcess();
    const pending = runStabilizationProcess('ffmpeg', [], {
      spawnProcess: () => process.child,
    });
    process.stderr.emit('data', 'encoder failed');
    process.close(2);
    await expect(pending).rejects.toBeInstanceOf(StabilizationProcessError);
  });
});

function fakeProcess(): {
  child: SpawnedStabilizationProcess;
  stdout: EventEmitter;
  stderr: EventEmitter;
  close(code: number | null): void;
} {
  const child = new EventEmitter() as SpawnedStabilizationProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  Object.assign(child, { stdout, stderr, kill: vi.fn(() => true) });
  return { child, stdout, stderr, close: (code) => child.emit('close', code) };
}
