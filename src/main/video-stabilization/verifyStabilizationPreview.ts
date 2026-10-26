import type { EstimatedFrameMotion } from '../video-diagnostics/analyzeVideo';
import {
  estimateFrameMotion,
  parseFfmpegProbeOutput,
  parseVidstabAscii,
} from '../video-diagnostics/analyzeVideo';
import { VIDEO_DIAGNOSTIC_THRESHOLDS } from '../../shared/videoDiagnostics';
import type {
  StabilizationBoundaryAssessment,
  StabilizationBoundaryMetric,
} from '../../shared/videoStabilization';
import {
  buildVidstabDetectArgs,
  runStabilizationProcess,
  type StabilizationProcessCallbacks,
  type StabilizationProcessResult,
} from './ffmpegStabilization';

export interface StabilizationOutputMetadata {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoFrameCount: number | null;
  videoLastPtsMs?: number | null;
  videoDurationMs: number | null;
  audioDurationMs: number | null;
}

export interface BoundaryMotionWindow {
  join: 'start' | 'end';
  before: EstimatedFrameMotion[];
  after: EstimatedFrameMotion[];
}

export interface VerifyStabilizationPreviewInput {
  outputPath: string;
  expectedWidth: number;
  expectedHeight: number;
  expectedFps: number;
  expectedFrameCount: number;
  expectedAudio: boolean;
  transformRecordCount: number;
  expectedTransformRecordCount: number;
  boundaryMode: 'scene-cuts' | 'exposed-handles';
  joinFramesInPreview?: Array<{ join: 'start' | 'end'; frame: number }>;
  probeOutput: (path: string, signal?: AbortSignal) => Promise<StabilizationOutputMetadata>;
  decodeOutput: (path: string, signal?: AbortSignal) => Promise<void>;
  analyzeBoundaryMotions: (
    path: string,
    signal?: AbortSignal,
  ) => Promise<BoundaryMotionWindow[]>;
}

export function parseDecodedStabilizationMetadata(
  stderr: string,
  stdout: string,
): StabilizationOutputMetadata {
  const metadata = parseFfmpegProbeOutput(stderr);
  const frames = [...stdout.matchAll(/(?:^|\r?\n)frame=\s*(\d+)/g)];
  const microsecondTimes = [...stdout.matchAll(/(?:^|\r?\n)out_time_us=(\d+)/g)];
  const legacyMicrosecondTimes = [...stdout.matchAll(/(?:^|\r?\n)out_time_ms=(\d+)/g)];
  const frameCount = frames.length > 0 ? Number(frames.at(-1)?.[1]) : null;
  const progressEndMs = microsecondTimes.length > 0
    ? Number(microsecondTimes.at(-1)?.[1]) / 1_000
    : legacyMicrosecondTimes.length > 0
      ? Number(legacyMicrosecondTimes.at(-1)?.[1]) / 1_000
      : null;
  const hasVideo = metadata.hasVideo === true;
  const hasAudio = metadata.hasAudio === true;
  const validFrameCount = Number.isSafeInteger(frameCount) ? frameCount : null;
  const videoLastPtsMs = hasVideo ? progressEndMs : null;
  const videoDurationMs = hasVideo && validFrameCount !== null && metadata.fps !== null
    ? validFrameCount / metadata.fps * 1_000
    : hasVideo ? metadata.durationMs : null;
  return {
    hasVideo,
    hasAudio,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    videoFrameCount: validFrameCount,
    videoLastPtsMs,
    videoDurationMs,
    audioDurationMs: hasAudio ? progressEndMs ?? metadata.durationMs : null,
  };
}

export interface FfmpegPreviewVerifierDependencies {
  makeTempDirectory?: () => Promise<string>;
  readTextFile?: (path: string) => Promise<string>;
  removeDirectory?: (path: string) => Promise<void>;
  runProcess?: (
    ffmpegPath: string,
    args: string[],
    callbacks: StabilizationProcessCallbacks,
    signal?: AbortSignal,
  ) => Promise<StabilizationProcessResult>;
}

export async function verifyStabilizationPreviewWithFfmpeg(
  input: VerifyStabilizationPreviewInput,
  ffmpegPath: string,
  signal?: AbortSignal,
  dependencies: FfmpegPreviewVerifierDependencies = {},
): Promise<VerifiedStabilizationPreview> {
  const execute = dependencies.runProcess ?? runStabilizationProcess;
  const decodedVideo = await execute(ffmpegPath, [
    '-hide_banner', '-nostdin', '-i', input.outputPath,
    '-map', '0:v:0', '-an',
    '-f', 'null', '-', '-progress', 'pipe:1', '-nostats',
  ], {}, signal);
  const videoMetadata = parseDecodedStabilizationMetadata(
    decodedVideo.stderr,
    decodedVideo.stdout,
  );
  let outputMetadata: StabilizationOutputMetadata = {
    ...videoMetadata,
    hasAudio: false,
    audioDurationMs: null,
  };
  if (input.expectedAudio) {
    const decodedAudio = await execute(ffmpegPath, [
      '-hide_banner', '-nostdin', '-i', input.outputPath,
      '-map', '0:a:0', '-vn',
      '-f', 'null', '-', '-progress', 'pipe:1', '-nostats',
    ], {}, signal);
    const audioMetadata = parseDecodedStabilizationMetadata(
      decodedAudio.stderr,
      decodedAudio.stdout,
    );
    outputMetadata = {
      ...outputMetadata,
      hasAudio: audioMetadata.hasAudio,
      audioDurationMs: audioMetadata.audioDurationMs,
    };
  }

  const analyzeBoundaryMotions = async (): Promise<BoundaryMotionWindow[]> => {
    if (input.boundaryMode === 'scene-cuts' || !input.joinFramesInPreview?.length) return [];
    const makeDirectory = dependencies.makeTempDirectory ??
      (() => mkdtemp(join(tmpdir(), 'combark-stabilization-boundary-')));
    const readText = dependencies.readTextFile ?? ((path) => readFile(path, 'utf8'));
    const remove = dependencies.removeDirectory ??
      ((path) => rm(path, { recursive: true, force: true }));
    const directory = await makeDirectory();
    const transformPath = join(directory, 'boundary.trf');
    try {
      await execute(ffmpegPath, buildVidstabDetectArgs({
        window: {
          sourcePath: input.outputPath,
          startFrame: 0,
          frameCount: input.expectedFrameCount,
          fps: input.expectedFps,
          width: input.expectedWidth,
          height: input.expectedHeight,
        },
        transformPath,
        preset: {
          strength: 'weak',
          detect: { shakiness: 5, accuracy: 9, stepsize: 12, mincontrast: 0.25 },
          transform: {
            smoothing: 8, interpol: 'bicubic', maxshift: 24, maxangleRadians: 0.03,
          },
        },
      }), {}, signal);
      const estimates = parseVidstabAscii(await readText(transformPath))
        .map((frame) => estimateFrameMotion(frame, {
          width: input.expectedWidth,
          height: input.expectedHeight,
        }));
      return input.joinFramesInPreview.map(({ join: joinName, frame: joinFrame }) => ({
        join: joinName,
        before: estimates.filter(({ frameNumber }) =>
          frameNumber >= joinFrame - 15 && frameNumber < joinFrame),
        after: estimates.filter(({ frameNumber }) =>
          frameNumber >= joinFrame && frameNumber < joinFrame + 15),
      }));
    } finally {
      await remove(directory);
    }
  };

  return verifyStabilizationPreview({
    ...input,
    probeOutput: async () => outputMetadata,
    decodeOutput: async () => undefined,
    analyzeBoundaryMotions,
  }, signal);
}

export interface VerifiedStabilizationPreview {
  metadata: StabilizationOutputMetadata;
  boundaryAssessment: StabilizationBoundaryAssessment;
}

export class StabilizationVerificationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'StabilizationVerificationError';
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function representative(
  values: EstimatedFrameMotion[],
): {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  diagonal: number;
  confidence: 'high' | 'medium';
} | null {
  const usable = values.filter((value) =>
    value.translationX !== null && value.translationY !== null &&
    value.rotationDegrees !== null && value.scalePercent !== null &&
    value.translationConfidence !== null && value.analysisDiagonal > 0);
  if (usable.length < 3) return null;
  return {
    x: median(usable.map(({ translationX }) => translationX as number)),
    y: median(usable.map(({ translationY }) => translationY as number)),
    rotation: median(usable.map(({ rotationDegrees }) => rotationDegrees as number)),
    scale: median(usable.map(({ scalePercent }) => scalePercent as number)),
    diagonal: median(usable.map(({ analysisDiagonal }) => analysisDiagonal)),
    confidence: usable.every(({ translationConfidence }) => translationConfidence === 'high')
      ? 'high'
      : 'medium',
  };
}

export function assessStabilizationBoundaries(
  mode: 'scene-cuts' | 'exposed-handles',
  windows: BoundaryMotionWindow[],
): StabilizationBoundaryAssessment {
  if (mode === 'scene-cuts') {
    return { status: 'protected-scene-cut', metrics: [], messages: [] };
  }
  if (windows.length === 0) {
    return {
      status: 'unverifiable',
      metrics: [],
      messages: ['연결부 움직임을 검증할 자료가 없습니다.'],
    };
  }
  const metrics: StabilizationBoundaryMetric[] = [];
  const messages: string[] = [];
  let unverifiable = false;
  let warning = false;
  for (const window of windows) {
    const before = representative(window.before);
    const after = representative(window.after);
    if (!before || !after) {
      unverifiable = true;
      metrics.push({
        join: window.join,
        translationDiagonalRatio: null,
        rotationDegrees: null,
        scalePercent: null,
        confidence: null,
      });
      messages.push(`${window.join === 'start' ? '시작' : '종료'} 연결부를 검증할 수 없습니다.`);
      continue;
    }
    const translation = Math.hypot(after.x - before.x, after.y - before.y) /
      Math.max(before.diagonal, after.diagonal);
    const rotation = Math.abs(after.rotation - before.rotation);
    const scale = Math.abs(after.scale - before.scale);
    metrics.push({
      join: window.join,
      translationDiagonalRatio: translation,
      rotationDegrees: rotation,
      scalePercent: scale,
      confidence: before.confidence === 'high' && after.confidence === 'high' ? 'high' : 'medium',
    });
    if (before.confidence !== 'high' || after.confidence !== 'high') {
      unverifiable = true;
      messages.push(`${window.join === 'start' ? '시작' : '종료'} 연결부 움직임 신뢰도가 낮아 육안 확인이 필요합니다.`);
    }
    if (translation > VIDEO_DIAGNOSTIC_THRESHOLDS.translationDiagonalRatio ||
        rotation > VIDEO_DIAGNOSTIC_THRESHOLDS.rotationDegrees ||
        scale > VIDEO_DIAGNOSTIC_THRESHOLDS.scalePercent) {
      warning = true;
      messages.push(`${window.join === 'start' ? '시작' : '종료'} 연결부에 화면 위치 점프 가능성이 있습니다.`);
    }
  }
  return {
    status: warning ? 'warning' : unverifiable ? 'unverifiable' : 'safe',
    metrics,
    messages,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('안정화 결과 검증이 취소되었습니다.');
  error.name = 'AbortError';
  throw error;
}

export async function verifyStabilizationPreview(
  input: VerifyStabilizationPreviewInput,
  signal?: AbortSignal,
): Promise<VerifiedStabilizationPreview> {
  throwIfAborted(signal);
  if (input.transformRecordCount !== input.expectedTransformRecordCount) {
    throw new StabilizationVerificationError('vidstab transform 프레임 수가 일치하지 않습니다.');
  }
  try {
    await input.decodeOutput(input.outputPath, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new StabilizationVerificationError('시험 결과 영상을 디코드할 수 없습니다.', error);
  }
  throwIfAborted(signal);
  const metadata = await input.probeOutput(input.outputPath, signal);
  const frameDurationMs = 1_000 / input.expectedFps;
  const expectedLastPtsMs = (input.expectedFrameCount - 1) * frameDurationMs;
  const expectedDurationMs = input.expectedFrameCount * frameDurationMs;
  const progressPrecisionMs = 0.001;
  if (!metadata.hasVideo) throw new StabilizationVerificationError('시험 결과에 영상 스트림이 없습니다.');
  if (metadata.width !== input.expectedWidth || metadata.height !== input.expectedHeight) {
    throw new StabilizationVerificationError('시험 결과 영상 크기가 원본과 일치하지 않습니다.');
  }
  if (metadata.fps === null || Math.abs(metadata.fps - input.expectedFps) > 0.01) {
    throw new StabilizationVerificationError('시험 결과 FPS가 원본과 일치하지 않습니다.');
  }
  if (metadata.videoFrameCount !== input.expectedFrameCount) {
    throw new StabilizationVerificationError('시험 결과 프레임 수가 일치하지 않습니다.');
  }
  if (metadata.videoLastPtsMs === null || metadata.videoLastPtsMs === undefined ||
      Math.abs(metadata.videoLastPtsMs - expectedLastPtsMs) > progressPrecisionMs ||
      metadata.videoDurationMs === null ||
      Math.abs(metadata.videoDurationMs - expectedDurationMs) > progressPrecisionMs) {
    throw new StabilizationVerificationError('시험 결과 영상 길이가 허용 범위를 벗어났습니다.');
  }
  if (input.expectedAudio) {
    if (!metadata.hasAudio || metadata.audioDurationMs === null ||
        Math.abs(metadata.audioDurationMs - expectedDurationMs) > frameDurationMs) {
      throw new StabilizationVerificationError('시험 결과 오디오 동기화가 허용 범위를 벗어났습니다.');
    }
  }
  throwIfAborted(signal);
  const windows = input.boundaryMode === 'scene-cuts'
    ? []
    : await input.analyzeBoundaryMotions(input.outputPath, signal);
  return {
    metadata,
    boundaryAssessment: assessStabilizationBoundaries(input.boundaryMode, windows),
  };
}
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
