import { spawn } from 'node:child_process';

import type {
  StabilizationEncoder,
  StabilizationStrength,
  StabilizationZoomPercent,
} from '../../shared/videoStabilization';

export interface StabilizationInputWindow {
  sourcePath: string;
  startFrame: number;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
}

export interface StabilizationPreset {
  strength: Exclude<StabilizationStrength, 'off'>;
  detect: {
    shakiness: number;
    accuracy: number;
    stepsize: number;
    mincontrast: number;
  };
  transform: {
    smoothing: number;
    interpol: 'bilinear' | 'bicubic';
    maxshift: number;
    maxangleRadians: number;
  };
}

export interface VidstabDetectInput {
  window: StabilizationInputWindow;
  transformPath: string;
  preset: StabilizationPreset;
}

export interface VidstabTransformInput {
  window: StabilizationInputWindow;
  transformPath?: string;
  outputPath: string;
  preset?: StabilizationPreset;
  strength: StabilizationStrength;
  zoomPercent: StabilizationZoomPercent;
  encoder: StabilizationEncoder;
  includeAudio: boolean;
  correctionStartOffsetFrames: number;
  correctionEndOffsetFramesExclusive: number;
  previewStartOffsetFrames: number;
  previewEndOffsetFramesExclusive: number;
}

type ProcessOutput = NodeJS.EventEmitter;

export interface SpawnedStabilizationProcess extends NodeJS.EventEmitter {
  stdout: ProcessOutput | null;
  stderr: ProcessOutput | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface StabilizationProcessCallbacks {
  spawnProcess?: (ffmpegPath: string, args: string[]) => SpawnedStabilizationProcess;
  maxOutputCharacters?: number;
  onProgressFrame?: (frame: number) => void;
}

export interface StabilizationProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class StabilizationProcessError extends Error {
  constructor(
    public readonly code: 'ffmpeg-start' | 'ffmpeg-failed' | 'insufficient-transforms',
    message: string,
  ) {
    super(message);
    this.name = 'StabilizationProcessError';
  }
}

function seconds(frame: number, fps: number): string {
  return String(Number((frame / fps).toFixed(6)));
}

function escapeFilterPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/([,;[\]])/g, '\\$1');
}

function inputArgs(window: StabilizationInputWindow): string[] {
  return [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-ss', seconds(window.startFrame, window.fps),
    '-i', window.sourcePath,
  ];
}

export function buildConstantFrameRateCheckArgs(window: StabilizationInputWindow): string[] {
  return [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-i', window.sourcePath,
    '-map', '0:v:0',
    '-vf', 'format=yuv420p,vfrdet',
    '-an',
    '-f', 'null',
    '-',
  ];
}

export function buildVidstabDetectArgs(input: VidstabDetectInput): string[] {
  const { detect } = input.preset;
  const filter = [
    'format=yuv420p',
    `trim=end_frame=${input.window.frameCount}`,
    'setpts=PTS-STARTPTS',
    'vfrdet',
    'vidstabdetect=' + [
      `shakiness=${detect.shakiness}`,
      `accuracy=${detect.accuracy}`,
      `stepsize=${detect.stepsize}`,
      `mincontrast=${detect.mincontrast}`,
      'fileformat=ascii',
      `result='${escapeFilterPath(input.transformPath)}'`,
    ].join(':'),
  ].join(',');
  return [
    ...inputArgs(input.window),
    '-map', '0:v:0',
    '-vf', filter,
    '-frames:v', String(input.window.frameCount),
    '-an',
    '-f', 'null',
    '-progress', 'pipe:1',
    '-',
  ];
}

export function assertConstantFrameRate(stderr: string): void {
  const match = stderr.match(/VFR:\s*([0-9.]+)\s*\((\d+)\/(\d+)\)/i);
  if (!match) {
    throw new StabilizationProcessError(
      'ffmpeg-failed',
      '원본 영상의 고정 프레임 레이트 여부를 확인할 수 없습니다.',
    );
  }
  if (Number(match[1]) !== 0 || Number(match[2]) !== 0) {
    throw new StabilizationProcessError(
      'ffmpeg-failed',
      '가변 프레임 레이트 영상은 정확한 장면 경계를 보장할 수 없어 시험 보정할 수 없습니다.',
    );
  }
}

function encoderArgs(encoder: StabilizationEncoder): string[] {
  return encoder === 'libx264'
    ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']
    : ['-c:v', 'h264_qsv', '-global_quality', '20', '-look_ahead', '0'];
}

function videoGraph(input: VidstabTransformInput): string {
  const previewStart = input.previewStartOffsetFrames;
  const previewEnd = input.previewEndOffsetFramesExclusive;
  const correctionStart = input.correctionStartOffsetFrames;
  const correctionEnd = input.correctionEndOffsetFramesExclusive;
  if (input.strength === 'off') {
    return `[0:v:0]format=yuv420p,trim=start_frame=${previewStart}:end_frame=${previewEnd},` +
      'setpts=PTS-STARTPTS[vout]';
  }
  if (!input.preset || !input.transformPath) {
    throw new TypeError('안정화 transform 설정이 필요합니다.');
  }

  const segments: Array<{ name: string; filter: string }> = [];
  if (previewStart < correctionStart) {
    segments.push({
      name: 'head',
      filter: `trim=start_frame=${previewStart}:end_frame=${correctionStart},setpts=PTS-STARTPTS`,
    });
  }
  const transform = input.preset.transform;
  segments.push({
    name: 'core',
    filter: 'vidstabtransform=' + [
      `input='${escapeFilterPath(input.transformPath)}'`,
      `smoothing=${transform.smoothing}`,
      `interpol=${transform.interpol}`,
      `maxshift=${transform.maxshift}`,
      `maxangle=${transform.maxangleRadians}`,
      'tripod=0',
      'optzoom=0',
      `zoom=${input.zoomPercent}`,
      'crop=black',
    ].join(':') +
      `,trim=start_frame=${correctionStart}:end_frame=${correctionEnd},setpts=PTS-STARTPTS`,
  });
  if (correctionEnd < previewEnd) {
    segments.push({
      name: 'tail',
      filter: `trim=start_frame=${correctionEnd}:end_frame=${previewEnd},setpts=PTS-STARTPTS`,
    });
  }

  if (segments.length === 1) {
    return `[0:v:0]format=yuv420p,trim=end_frame=${input.window.frameCount},` +
      `${segments[0].filter}[vout]`;
  }
  const labels = segments.map(({ name }) => name);
  return `[0:v:0]format=yuv420p,trim=end_frame=${input.window.frameCount},` +
    `split=${segments.length}${labels.map((name) => `[${name}Source]`).join('')};` +
    segments.map(({ name, filter }) => `[${name}Source]${filter}[${name}]`).join(';') +
    `;${labels.map((name) => `[${name}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`;
}

export function buildVidstabTransformArgs(input: VidstabTransformInput): string[] {
  const previewFrames = input.previewEndOffsetFramesExclusive - input.previewStartOffsetFrames;
  if (!Number.isSafeInteger(previewFrames) || previewFrames <= 0) {
    throw new RangeError('안정화 출력 프레임 범위가 올바르지 않습니다.');
  }
  const args = [
    ...inputArgs(input.window),
    '-filter_complex', videoGraph(input),
    '-map', '[vout]',
  ];
  if (input.includeAudio) {
    args.push(
      '-map', '0:a:0?',
      '-af', `atrim=start=${seconds(input.previewStartOffsetFrames, input.window.fps)}` +
        `:end=${seconds(input.previewEndOffsetFramesExclusive, input.window.fps)},asetpts=PTS-STARTPTS`,
    );
  } else {
    args.push('-an');
  }
  args.push(
    '-frames:v', String(previewFrames),
    ...encoderArgs(input.encoder),
    '-pix_fmt', 'yuv420p',
  );
  if (input.includeAudio) args.push('-c:a', 'aac', '-ar', '48000', '-ac', '2');
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', input.outputPath);
  return args;
}

export function parseFfmpegFrameProgress(text: string): number | null {
  const matches = [...text.matchAll(/(?:^|\r?\n)frame=\s*(\d+)/g)];
  if (matches.length === 0) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function assertTransformRecordCount(content: string, expected: number): void {
  const count = content.split(/\r?\n/).filter((line) => /^Frame\s+\d+\s+/.test(line)).length;
  if (count !== expected) {
    throw new StabilizationProcessError(
      'insufficient-transforms',
      `안정화 분석 프레임 수가 일치하지 않습니다 (${count}/${expected}).`,
    );
  }
}

function abortError(): Error {
  const error = new Error('안정화 시험 보정이 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

export function runStabilizationProcess(
  ffmpegPath: string,
  args: string[],
  callbacks: StabilizationProcessCallbacks = {},
  signal?: AbortSignal,
): Promise<StabilizationProcessResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  const maximum = callbacks.maxOutputCharacters ?? 256 * 1024;
  return new Promise((resolve, reject) => {
    let child: SpawnedStabilizationProcess;
    try {
      child = (callbacks.spawnProcess ?? ((path, processArgs) => spawn(path, processArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as SpawnedStabilizationProcess))(ffmpegPath, args);
    } catch (error) {
      reject(new StabilizationProcessError(
        'ffmpeg-start',
        error instanceof Error ? error.message : 'FFmpeg를 시작하지 못했습니다.',
      ));
      return;
    }
    let stdout = '';
    let stderr = '';
    let insufficientTransforms = false;
    let settled = false;
    let canceled = false;
    const append = (previous: string, chunk: unknown): string =>
      `${previous}${String(chunk)}`.slice(-maximum);
    child.stdout?.on('data', (chunk: unknown) => {
      stdout = append(stdout, chunk);
      const frame = parseFfmpegFrameProgress(String(chunk));
      if (frame !== null) callbacks.onProgressFrame?.(frame);
    });
    child.stderr?.on('data', (chunk: unknown) => {
      const text = String(chunk);
      if (/not enough transforms/i.test(text)) insufficientTransforms = true;
      stderr = append(stderr, text);
    });
    const onAbort = (): void => {
      if (settled || canceled) return;
      canceled = true;
      child.kill();
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(canceled
        ? abortError()
        : new StabilizationProcessError('ffmpeg-start', error.message));
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (canceled) {
        reject(abortError());
      } else if (code !== 0) {
        reject(new StabilizationProcessError(
          insufficientTransforms ? 'insufficient-transforms' : 'ffmpeg-failed',
          `FFmpeg 안정화 실행에 실패했습니다 (${code ?? 'unknown'}). ${stderr.trim()}`,
        ));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}
