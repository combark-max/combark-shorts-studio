import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  RawDiagnosticEvent,
  VideoDiagnosticProgress,
  VideoDiagnosticResult,
  VideoMetadata,
} from '../../shared/videoDiagnostics';
import {
  dedupeSceneCandidates,
  mergeDiagnosticEvents,
  suppressEventsNearScenes,
  VIDEO_DIAGNOSTIC_THRESHOLDS,
} from '../../shared/videoDiagnostics';

export type DiagnosticAnalysisErrorCode =
  | 'file-access'
  | 'invalid-video'
  | 'no-video-stream'
  | 'ffmpeg-start'
  | 'ffmpeg-analysis'
  | 'motion-data';

export class DiagnosticAnalysisError extends Error {
  constructor(
    public readonly code: DiagnosticAnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiagnosticAnalysisError';
  }
}

type ProcessOutput = NodeJS.EventEmitter;

export interface SpawnedFfmpegProcess extends NodeJS.EventEmitter {
  stdout: ProcessOutput | null;
  stderr: ProcessOutput | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface FfmpegRunCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  spawnProcess?: (ffmpegPath: string, args: string[]) => SpawnedFfmpegProcess;
  maxOutputCharacters?: number;
}

export interface FfmpegRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunFfmpeg = (
  ffmpegPath: string,
  args: string[],
  callbacks: FfmpegRunCallbacks,
  signal?: AbortSignal,
) => Promise<FfmpegRunResult>;

export interface VideoDiagnosticDependencies {
  ffmpegPath: string;
  runFfmpeg?: RunFfmpeg;
  onProgress?: (progress: VideoDiagnosticProgress) => void;
  makeTempDirectory?: () => Promise<string>;
  readTextFile?: (path: string) => Promise<string>;
  removeDirectory?: (path: string) => Promise<void>;
  onCleanupError?: (error: unknown) => void;
}

function abortError(): Error {
  const error = new Error('영상 진단이 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

export function runFfmpegProcess(
  ffmpegPath: string,
  args: string[],
  callbacks: FfmpegRunCallbacks = {},
  signal?: AbortSignal,
): Promise<FfmpegRunResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  const maxLength = callbacks.maxOutputCharacters ?? 256 * 1024;

  return new Promise((resolve, reject) => {
    let child: SpawnedFfmpegProcess;
    try {
      child = (callbacks.spawnProcess ?? ((path, processArgs) => spawn(path, processArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as SpawnedFfmpegProcess))(ffmpegPath, args);
    } catch (error) {
      reject(new DiagnosticAnalysisError(
        'ffmpeg-start',
        error instanceof Error ? error.message : 'FFmpeg를 시작하지 못했습니다.',
      ));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let canceled = false;
    const append = (previous: string, chunk: unknown): string =>
      `${previous}${String(chunk)}`.slice(-maxLength);
    child.stdout?.on('data', (chunk: unknown) => {
      const text = String(chunk);
      stdout = append(stdout, text);
      callbacks.onStdout?.(text);
    });
    child.stderr?.on('data', (chunk: unknown) => {
      const text = String(chunk);
      stderr = append(stderr, text);
      callbacks.onStderr?.(text);
    });

    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      if (settled || canceled) return;
      canceled = true;
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.once('error', (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(canceled ? abortError() : new DiagnosticAnalysisError('ffmpeg-start', error.message));
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (canceled) {
        reject(abortError());
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseFfmpegProbeOutput(stderr: string): VideoMetadata {
  const inventoryParsed = /^Input #\d+/m.test(stderr);
  const videoLine = stderr.split(/\r?\n/).find((line) => /Stream #\S+.*Video:/i.test(line));
  const audioLine = stderr.split(/\r?\n/).find((line) => /Stream #\S+.*Audio:/i.test(line));
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  const dimensionsMatch = videoLine?.match(/(?:^|\D)(\d{2,5})x(\d{2,5})(?:\D|$)/);
  const fpsMatch = videoLine?.match(/(?:^|,\s*)(\d+(?:\.\d+)?)\s+fps(?:,|\s|$)/i);

  let durationMs: number | null = null;
  if (durationMatch) {
    durationMs = finitePositive((
      Number(durationMatch[1]) * 3600 +
      Number(durationMatch[2]) * 60 +
      Number(durationMatch[3])
    ) * 1000);
    if (durationMs !== null) durationMs = Math.round(durationMs);
  }

  return {
    durationMs,
    width: dimensionsMatch ? finitePositive(Number(dimensionsMatch[1])) : null,
    height: dimensionsMatch ? finitePositive(Number(dimensionsMatch[2])) : null,
    fps: fpsMatch ? finitePositive(Number(fpsMatch[1])) : null,
    hasVideo: inventoryParsed ? Boolean(videoLine) : null,
    hasAudio: inventoryParsed ? Boolean(audioLine) : null,
  };
}

function classifyProbeFailure(stderr: string): DiagnosticAnalysisError {
  if (/permission denied|access is denied|operation not permitted/i.test(stderr)) {
    return new DiagnosticAnalysisError('file-access', '영상 파일에 접근할 수 없습니다.');
  }
  if (/invalid data|moov atom not found|error opening input|could not find codec parameters/i.test(stderr)) {
    return new DiagnosticAnalysisError('invalid-video', '올바르지 않거나 손상된 영상 파일입니다.');
  }
  return new DiagnosticAnalysisError('ffmpeg-analysis', '영상 정보를 확인하지 못했습니다.');
}

export async function probeDiagnosticVideo(
  sourcePath: string,
  dependencies: VideoDiagnosticDependencies,
  signal?: AbortSignal,
): Promise<VideoMetadata> {
  const execute = dependencies.runFfmpeg ?? runFfmpegProcess;
  const result = await execute(dependencies.ffmpegPath, [
    '-hide_banner',
    '-nostdin',
    '-i', sourcePath,
    '-map', '0:v:0?',
    '-frames:v', '1',
    '-map', '0:a:0?',
    '-frames:a', '1',
    '-f', 'null',
    '-',
  ], {}, signal);
  if (result.code !== 0) throw classifyProbeFailure(result.stderr);
  return parseFfmpegProbeOutput(result.stderr);
}

// Later analysis stages in this module deliberately consume only read-only
// FFmpeg metadata and local-motion output. These declarations keep their
// public result boundary explicit while each stage is implemented.
export interface FrameAnalysisSample {
  timeMs: number;
  sceneScore: number | null;
  mafd: number | null;
  yAverage: number | null;
}

export interface MotionAnalysisResult {
  events: RawDiagnosticEvent[];
  uncertainties: VideoDiagnosticResult['uncertainties'];
}

export interface VidstabLocalMotion {
  vx: number;
  vy: number;
  fieldX: number;
  fieldY: number;
  fieldSize: number;
  contrast: number;
  match: number;
}

export interface VidstabFrameMotions {
  frameNumber: number;
  motions: VidstabLocalMotion[];
}

export interface AnalysisFrameSize {
  width: number;
  height: number;
}

export interface EstimatedFrameMotion {
  frameNumber: number;
  translationX: number | null;
  translationY: number | null;
  rotationDegrees: number | null;
  scalePercent: number | null;
  translationConfidence: 'medium' | 'high' | null;
  uncertaintyCode: VideoDiagnosticResult['uncertainties'][number]['code'] | null;
  similarityUncertaintyCode: VideoDiagnosticResult['uncertainties'][number]['code'] | null;
  analysisDiagonal: number;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFrameAnalysisOutput(stderr: string): FrameAnalysisSample[] {
  const samples: FrameAnalysisSample[] = [];
  let current: FrameAnalysisSample | null = null;
  const pushCurrent = (): void => {
    if (current && Number.isFinite(current.timeMs) && current.timeMs >= 0) {
      samples.push(current);
    }
  };

  for (const line of stderr.split(/\r?\n/)) {
    const timeMatch = line.match(/(?:^|\s)pts_time:([+-]?\d+(?:\.\d+)?)/);
    if (timeMatch) {
      const seconds = Number(timeMatch[1]);
      const timeMs = Math.round(seconds * 1000);
      if (!Number.isFinite(seconds) || seconds < 0) {
        pushCurrent();
        current = null;
      } else if (!current || current.timeMs !== timeMs) {
        pushCurrent();
        current = { timeMs, sceneScore: null, mafd: null, yAverage: null };
      }
      continue;
    }
    if (!current) continue;
    const metadataMatch = line.match(/lavfi\.(scd\.score|scd\.mafd|signalstats\.YAVG)=([^\s]+)/);
    if (!metadataMatch) continue;
    const value = parseOptionalNumber(metadataMatch[2]);
    if (metadataMatch[1] === 'scd.score') current.sceneScore = value;
    if (metadataMatch[1] === 'scd.mafd') current.mafd = value;
    if (metadataMatch[1] === 'signalstats.YAVG') current.yAverage = value;
  }
  pushCurrent();
  return samples.sort((left, right) => left.timeMs - right.timeMs);
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

export function buildSceneAndFrameEvents(
  samples: FrameAnalysisSample[],
): RawDiagnosticEvent[] {
  const ordered = [...samples]
    .filter(({ timeMs }) => Number.isFinite(timeMs) && timeMs >= 0)
    .sort((left, right) => left.timeMs - right.timeMs);
  const scenes = dedupeSceneCandidates(ordered
    .filter(({ sceneScore }) => sceneScore !== null &&
      sceneScore >= VIDEO_DIAGNOSTIC_THRESHOLDS.sceneScore)
    .map(({ timeMs, sceneScore }): RawDiagnosticEvent => ({
      type: 'scene-change' as const,
      timeMs,
      scoreMultiple: null,
      rawScore: sceneScore as number,
      confidence: null,
    })));
  const otherEvents: RawDiagnosticEvent[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previousBrightness = ordered[index - 1].yAverage;
    const brightness = ordered[index].yAverage;
    if (previousBrightness !== null && brightness !== null) {
      const delta = Math.abs(brightness - previousBrightness);
      if (delta >= VIDEO_DIAGNOSTIC_THRESHOLDS.brightnessDelta) {
        otherEvents.push({
          type: 'brightness-change',
          timeMs: ordered[index].timeMs,
          scoreMultiple: delta / VIDEO_DIAGNOSTIC_THRESHOLDS.brightnessDelta,
          rawScore: delta,
          confidence: 'medium',
        });
      }
    }

    const mafd = ordered[index].mafd;
    const history = ordered
      .slice(Math.max(0, index - 15), index)
      .map(({ mafd: value }) => value)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (mafd !== null && history.length >= 5) {
      const baseline = median(history);
      const deviation = median(history.map((value) => Math.abs(value - baseline)));
      const threshold = Math.max(10, baseline + 6 * Math.max(deviation, 0.25));
      if (mafd >= threshold) {
        otherEvents.push({
          type: 'frame-change',
          timeMs: ordered[index].timeMs,
          scoreMultiple: mafd / threshold,
          rawScore: mafd,
          confidence: 'medium',
        });
      }
    }
  }

  return suppressEventsNearScenes([...scenes, ...otherEvents], scenes);
}

function reportFfmpegProgress(
  output: string,
  durationMs: number | null,
  stage: VideoDiagnosticProgress['stage'],
  report: ((progress: VideoDiagnosticProgress) => void) | undefined,
): void {
  const matches = [...output.matchAll(/(?:^|\r?\n)out_time_(?:us|ms)=(\d+)/g)];
  const latest = matches.at(-1);
  if (!latest) return;
  const analyzedMs = Math.round(Number(latest[1]) / 1000);
  const percent = durationMs && durationMs > 0
    ? Math.min(100, Math.max(0, analyzedMs / durationMs * 100))
    : null;
  report?.({ stage, analyzedMs, durationMs, percent });
}

export async function runFrameAnalysis(
  sourcePath: string,
  metadata: VideoMetadata,
  dependencies: VideoDiagnosticDependencies,
  signal?: AbortSignal,
): Promise<RawDiagnosticEvent[]> {
  const execute = dependencies.runFfmpeg ?? runFfmpegProcess;
  let progressOutput = '';
  let frameMetadataOutput = '';
  const result = await execute(dependencies.ffmpegPath, [
    '-hide_banner', '-nostdin', '-i', sourcePath,
    '-map', '0:v:0',
    '-vf', [
      `scdet=threshold=${VIDEO_DIAGNOSTIC_THRESHOLDS.sceneScore}`,
      'signalstats',
      'metadata=mode=print:key=lavfi.scd.score',
      'metadata=mode=print:key=lavfi.scd.mafd',
      'metadata=mode=print:key=lavfi.signalstats.YAVG',
    ].join(','),
    '-an', '-f', 'null', '-',
    '-progress', 'pipe:1', '-nostats',
  ], {
    onStdout: (chunk) => {
      progressOutput = `${progressOutput}${chunk}`.slice(-16_384);
      reportFfmpegProgress(
        progressOutput,
        metadata.durationMs,
        'frame-analysis',
        dependencies.onProgress,
      );
    },
    onStderr: (chunk) => {
      frameMetadataOutput += chunk;
    },
  }, signal);
  if (result.code !== 0) {
    throw new DiagnosticAnalysisError('ffmpeg-analysis', '프레임 분석에 실패했습니다.');
  }
  return buildSceneAndFrameEvents(parseFrameAnalysisOutput(
    frameMetadataOutput.length > 0 ? frameMetadataOutput : result.stderr,
  ));
}

export function parseVidstabAscii(content: string): VidstabFrameMotions[] {
  if (!/^VID\.STAB\s+1(?:\r?$)/m.test(content)) return [];
  const frames: VidstabFrameMotions[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith('Frame ')) continue;
    const frameMatch = line.match(/^Frame\s+(\d+)\s+\(List\s+(\d+)\s+\[(.*)\]\)$/);
    if (!frameMatch) return [];
    const frameNumber = Number(frameMatch[1]);
    const expectedCount = Number(frameMatch[2]);
    const body = frameMatch[3];
    const motions: VidstabLocalMotion[] = [];
    const motionPattern = /\(LM\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = motionPattern.exec(body)) !== null) {
      const values = match.slice(1).map(Number);
      if (values.some((value) => !Number.isFinite(value))) return [];
      motions.push({
        vx: values[0], vy: values[1], fieldX: values[2], fieldY: values[3],
        fieldSize: values[4], contrast: values[5], match: values[6],
      });
    }
    if (motions.length !== expectedCount ||
      (expectedCount === 0 ? body.trim() !== '' : !body.includes('(LM'))) return [];
    frames.push({ frameNumber, motions });
  }
  return frames;
}

function motionCoverage(
  motions: VidstabLocalMotion[],
  size: AnalysisFrameSize,
): { x: number; y: number } {
  if (motions.length === 0 || size.width <= 0 || size.height <= 0) return { x: 0, y: 0 };
  const xs = motions.map(({ fieldX }) => fieldX);
  const ys = motions.map(({ fieldY }) => fieldY);
  return {
    x: (Math.max(...xs) - Math.min(...xs)) / size.width,
    y: (Math.max(...ys) - Math.min(...ys)) / size.height,
  };
}

function fitSimilarity(motions: VidstabLocalMotion[]): {
  rotationDegrees: number;
  scalePercent: number;
  residual: number;
  inlierRatio: number;
} | null {
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanX = mean(motions.map(({ fieldX }) => fieldX));
  const meanY = mean(motions.map(({ fieldY }) => fieldY));
  const meanU = mean(motions.map(({ vx }) => vx));
  const meanV = mean(motions.map(({ vy }) => vy));
  let denominator = 0;
  let numeratorA = 0;
  let numeratorB = 0;
  for (const motion of motions) {
    const x = motion.fieldX - meanX;
    const y = motion.fieldY - meanY;
    const u = motion.vx - meanU;
    const v = motion.vy - meanV;
    denominator += x * x + y * y;
    numeratorA += x * u + y * v;
    numeratorB += x * v - y * u;
  }
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  const tx = meanU - a * meanX + b * meanY;
  const ty = meanV - b * meanX - a * meanY;
  const residuals = motions.map((motion) => Math.hypot(
    motion.vx - (tx + a * motion.fieldX - b * motion.fieldY),
    motion.vy - (ty + b * motion.fieldX + a * motion.fieldY),
  ));
  const residualMedian = median(residuals);
  const residualMad = median(residuals.map((value) => Math.abs(value - residualMedian)));
  const inlierLimit = Math.max(0.5, residualMedian + 3 * Math.max(residualMad, 0.05));
  const inliers = residuals.filter((value) => value <= inlierLimit);
  const scale = Math.hypot(1 + a, b);
  return {
    rotationDegrees: Math.atan2(b, 1 + a) * 180 / Math.PI,
    scalePercent: (scale - 1) * 100,
    residual: Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length),
    inlierRatio: inliers.length / motions.length,
  };
}

export function estimateFrameMotion(
  frame: VidstabFrameMotions,
  analysisSize: AnalysisFrameSize,
): EstimatedFrameMotion {
  const diagonal = Math.hypot(analysisSize.width, analysisSize.height);
  const valid = frame.motions.filter((motion) =>
    Object.values(motion).every((value) => Number.isFinite(value)));
  const coverage = motionCoverage(valid, analysisSize);
  let uncertaintyCode: EstimatedFrameMotion['uncertaintyCode'] = null;
  if (valid.length < 8) uncertaintyCode = 'insufficient-motion-data';
  else if (coverage.x < 0.25 || coverage.y < 0.25) uncertaintyCode = 'poor-motion-coverage';

  let translationX: number | null = null;
  let translationY: number | null = null;
  let translationConfidence: EstimatedFrameMotion['translationConfidence'] = null;
  let translationInlierRatio = 0;
  if (!uncertaintyCode) {
    const centerX = median(valid.map(({ vx }) => vx));
    const centerY = median(valid.map(({ vy }) => vy));
    const distances = valid.map(({ vx, vy }) => Math.hypot(vx - centerX, vy - centerY));
    const distanceMedian = median(distances);
    const distanceMad = median(distances.map((value) => Math.abs(value - distanceMedian)));
    const limit = Math.max(1, distanceMedian + 3 * Math.max(distanceMad, 0.05));
    const inliers = valid.filter((_motion, index) => distances[index] <= limit);
    translationInlierRatio = inliers.length / valid.length;
    if (translationInlierRatio >= 0.5) {
      translationX = median(inliers.map(({ vx }) => vx));
      translationY = median(inliers.map(({ vy }) => vy));
      translationConfidence = translationInlierRatio >= 0.75 ? 'high' : 'medium';
    } else {
      uncertaintyCode = 'unstable-motion-fit';
    }
  }

  let rotationDegrees: number | null = null;
  let scalePercent: number | null = null;
  let similarityUncertaintyCode: EstimatedFrameMotion['similarityUncertaintyCode'] = null;
  if (valid.length < 12) {
    similarityUncertaintyCode = 'insufficient-motion-data';
  } else if (coverage.x < 0.4 || coverage.y < 0.4) {
    similarityUncertaintyCode = 'poor-motion-coverage';
  } else {
    const fit = fitSimilarity(valid);
    const residualCap = diagonal * VIDEO_DIAGNOSTIC_THRESHOLDS.translationDiagonalRatio;
    if (fit && fit.inlierRatio >= 0.65 && fit.residual <= residualCap) {
      rotationDegrees = fit.rotationDegrees;
      scalePercent = fit.scalePercent;
    } else {
      similarityUncertaintyCode = 'unstable-motion-fit';
    }
  }

  return {
    frameNumber: frame.frameNumber,
    translationX,
    translationY,
    rotationDegrees,
    scalePercent,
    translationConfidence,
    uncertaintyCode,
    similarityUncertaintyCode,
    analysisDiagonal: diagonal,
  };
}

export function buildMotionEvents(
  estimates: EstimatedFrameMotion[],
  sceneEvents: RawDiagnosticEvent[],
  fps: number,
): MotionAnalysisResult {
  const validFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const ordered = [...estimates].sort((left, right) => left.frameNumber - right.frameNumber);
  const events: RawDiagnosticEvent[] = [];
  const uncertainties: VideoDiagnosticResult['uncertainties'] = [];
  const residuals: Array<{ timeMs: number; x: number; y: number; threshold: number; confidence: 'medium' | 'high' }> = [];

  for (const estimate of ordered) {
    const timeMs = estimate.frameNumber / validFps * 1000;
    if (estimate.similarityUncertaintyCode) {
      uncertainties.push({
        code: estimate.similarityUncertaintyCode,
        message: '지점 수, 공간 분포 또는 적합 안정성이 부족해 회전·확대 변화를 판단하지 못했습니다.',
        startMs: timeMs,
        endMs: timeMs,
      });
    }
    if (estimate.translationX === null || estimate.translationY === null) {
      if (estimate.uncertaintyCode) {
        uncertainties.push({
          code: estimate.uncertaintyCode,
          message: '로컬 움직임의 수, 분포 또는 일관성이 부족해 전역 움직임을 판단하지 못했습니다.',
          startMs: timeMs,
          endMs: timeMs,
        });
      }
      continue;
    }
    const history = ordered
      .filter((candidate) => candidate.frameNumber < estimate.frameNumber)
      .slice(-15)
      .filter((candidate) => candidate.translationX !== null && candidate.translationY !== null);
    if (history.length < 5) continue;
    const baselineX = median(history.map(({ translationX }) => translationX as number));
    const baselineY = median(history.map(({ translationY }) => translationY as number));
    const residualX = estimate.translationX - baselineX;
    const residualY = estimate.translationY - baselineY;
    const magnitude = Math.hypot(residualX, residualY);
    const threshold = estimate.analysisDiagonal * VIDEO_DIAGNOSTIC_THRESHOLDS.translationDiagonalRatio;
    if (magnitude >= threshold * 0.2) {
      residuals.push({
        timeMs, x: residualX, y: residualY, threshold,
        confidence: estimate.translationConfidence ?? 'medium',
      });
    }
    if (magnitude >= threshold) {
      events.push({
        type: 'motion-jump', timeMs, scoreMultiple: magnitude / threshold,
        rawScore: magnitude, confidence: estimate.translationConfidence,
      });
    }

    if (estimate.rotationDegrees !== null && history.length >= 5) {
      const rotations = history.map(({ rotationDegrees }) => rotationDegrees).filter((value): value is number => value !== null);
      if (rotations.length >= 5) {
        const delta = Math.abs(estimate.rotationDegrees - median(rotations));
        if (delta >= VIDEO_DIAGNOSTIC_THRESHOLDS.rotationDegrees) events.push({
          type: 'rotation-change', timeMs,
          scoreMultiple: delta / VIDEO_DIAGNOSTIC_THRESHOLDS.rotationDegrees,
          rawScore: delta, confidence: estimate.translationConfidence,
        });
      }
    }
    if (estimate.scalePercent !== null && history.length >= 5) {
      const scales = history.map(({ scalePercent }) => scalePercent).filter((value): value is number => value !== null);
      if (scales.length >= 5) {
        const delta = Math.abs(estimate.scalePercent - median(scales));
        if (delta >= VIDEO_DIAGNOSTIC_THRESHOLDS.scalePercent) events.push({
          type: 'scale-change', timeMs,
          scoreMultiple: delta / VIDEO_DIAGNOSTIC_THRESHOLDS.scalePercent,
          rawScore: delta, confidence: estimate.translationConfidence,
        });
      }
    }
  }

  const jitterEvents: RawDiagnosticEvent[] = [];
  for (let index = 3; index < residuals.length; index += 1) {
    const window = residuals.filter(({ timeMs }) =>
      timeMs >= residuals[index].timeMs - VIDEO_DIAGNOSTIC_THRESHOLDS.jitterMergeMs &&
      timeMs <= residuals[index].timeMs);
    if (window.length < 4) continue;
    const dominant = window.map(({ x, y }) => Math.abs(x) >= Math.abs(y) ? x : y);
    let reversals = 0;
    for (let valueIndex = 1; valueIndex < dominant.length; valueIndex += 1) {
      if (Math.sign(dominant[valueIndex]) !== Math.sign(dominant[valueIndex - 1])) reversals += 1;
    }
    const accumulated = window.reduce((sum, item) => sum + Math.hypot(item.x, item.y), 0);
    const threshold = window[window.length - 1].threshold * 4;
    if (reversals >= 3 && accumulated >= threshold) {
      jitterEvents.push({
        type: 'motion-jitter', timeMs: residuals[index].timeMs,
        scoreMultiple: accumulated / threshold,
        rawScore: accumulated,
        confidence: residuals[index].confidence,
      });
    }
  }

  let jitterGroup: RawDiagnosticEvent[] = [];
  for (const jitter of jitterEvents) {
    const previous = jitterGroup.at(-1);
    if (!previous || jitter.timeMs - previous.timeMs <= VIDEO_DIAGNOSTIC_THRESHOLDS.jitterMergeMs) {
      jitterGroup.push(jitter);
      continue;
    }
    events.push(jitterGroup.reduce((peak, candidate) =>
      (candidate.scoreMultiple ?? 0) > (peak.scoreMultiple ?? 0) ? candidate : peak));
    jitterGroup = [jitter];
  }
  if (jitterGroup.length > 0) {
    events.push(jitterGroup.reduce((peak, candidate) =>
      (candidate.scoreMultiple ?? 0) > (peak.scoreMultiple ?? 0) ? candidate : peak));
  }

  return {
    events: suppressEventsNearScenes(events, sceneEvents),
    uncertainties: consolidateUncertainties(uncertainties),
  };
}

function consolidateUncertainties(
  uncertainties: VideoDiagnosticResult['uncertainties'],
): VideoDiagnosticResult['uncertainties'] {
  const byCode = new Map<VideoDiagnosticResult['uncertainties'][number]['code'], VideoDiagnosticResult['uncertainties'][number]>();
  for (const uncertainty of uncertainties) {
    const existing = byCode.get(uncertainty.code);
    if (!existing) byCode.set(uncertainty.code, { ...uncertainty });
    else {
      existing.startMs = Math.min(existing.startMs ?? Infinity, uncertainty.startMs ?? Infinity);
      existing.endMs = Math.max(existing.endMs ?? 0, uncertainty.endMs ?? 0);
    }
  }
  return [...byCode.values()];
}

function analysisSize(metadata: VideoMetadata): AnalysisFrameSize {
  if (!metadata.width || !metadata.height) return { width: 540, height: 960 };
  const ratio = Math.min(540 / metadata.width, 960 / metadata.height, 1);
  return {
    width: Math.max(2, Math.round(metadata.width * ratio)),
    height: Math.max(2, Math.round(metadata.height * ratio)),
  };
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function runMotionAnalysis(
  sourcePath: string,
  metadata: VideoMetadata,
  dependencies: VideoDiagnosticDependencies,
  signal?: AbortSignal,
  sceneEvents: RawDiagnosticEvent[] = [],
): Promise<MotionAnalysisResult> {
  const makeDirectory = dependencies.makeTempDirectory ??
    (() => mkdtemp(join(tmpdir(), 'combark-video-diagnostics-')));
  const readText = dependencies.readTextFile ?? ((path) => readFile(path, 'utf8'));
  const remove = dependencies.removeDirectory ?? ((path) => rm(path, { recursive: true, force: true }));
  const execute = dependencies.runFfmpeg ?? runFfmpegProcess;
  const tempDirectory = await makeDirectory();
  const transformPath = join(tempDirectory, 'motions.trf');
  const size = analysisSize(metadata);
  let progressOutput = '';
  try {
    const result = await execute(dependencies.ffmpegPath, [
      '-hide_banner', '-nostdin', '-i', sourcePath,
      '-map', '0:v:0',
      '-vf', `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,vidstabdetect=result='${escapeFilterPath(transformPath)}':fileformat=ascii:shakiness=5:accuracy=9:stepsize=12:mincontrast=0.25`,
      '-an', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats',
    ], {
      onStdout: (chunk) => {
        progressOutput = `${progressOutput}${chunk}`.slice(-16_384);
        reportFfmpegProgress(progressOutput, metadata.durationMs, 'motion-analysis', dependencies.onProgress);
      },
    }, signal);
    if (result.code !== 0) {
      throw new DiagnosticAnalysisError('ffmpeg-analysis', '움직임 분석에 실패했습니다.');
    }
    const frames = parseVidstabAscii(await readText(transformPath));
    if (frames.length === 0) {
      return {
        events: [],
        uncertainties: [{
          code: 'insufficient-motion-data',
          message: 'vidstab 로컬 움직임 데이터가 없거나 해석할 수 없습니다.',
        }],
      };
    }
    return buildMotionEvents(
      frames.map((frame) => estimateFrameMotion(frame, size)),
      sceneEvents,
      metadata.fps ?? 30,
    );
  } finally {
    try {
      await remove(tempDirectory);
    } catch (error) {
      dependencies.onCleanupError?.(error);
    }
  }
}

export async function analyzeDiagnosticVideo(
  sourcePath: string,
  dependencies: VideoDiagnosticDependencies,
  signal?: AbortSignal,
): Promise<VideoDiagnosticResult> {
  dependencies.onProgress?.({ stage: 'probing', analyzedMs: null, durationMs: null, percent: null });
  const metadata = await probeDiagnosticVideo(sourcePath, dependencies, signal);
  if (metadata.hasVideo !== true) {
    throw new DiagnosticAnalysisError('no-video-stream', '영상 스트림이 있는 MP4 파일이 필요합니다.');
  }
  const frameEvents = await runFrameAnalysis(sourcePath, metadata, dependencies, signal);
  const sceneEvents = frameEvents.filter(({ type }) => type === 'scene-change');
  const motion = await runMotionAnalysis(sourcePath, metadata, dependencies, signal, sceneEvents);
  dependencies.onProgress?.({
    stage: 'finalizing', analyzedMs: metadata.durationMs,
    durationMs: metadata.durationMs, percent: metadata.durationMs === null ? null : 100,
  });
  const candidates = mergeDiagnosticEvents([
    ...frameEvents,
    ...suppressEventsNearScenes(motion.events, sceneEvents),
  ]);
  const uncertainties = [...motion.uncertainties];
  if ([metadata.durationMs, metadata.width, metadata.height, metadata.fps].some((value) => value === null)) {
    uncertainties.push({
      code: 'partial-metadata',
      message: '일부 영상 정보를 확인하지 못해 진단 정확도가 제한될 수 있습니다.',
    });
  }
  dependencies.onProgress?.({
    stage: 'complete', analyzedMs: metadata.durationMs,
    durationMs: metadata.durationMs, percent: metadata.durationMs === null ? null : 100,
  });
  return {
    candidates,
    uncertainties: consolidateUncertainties(uncertainties),
    notices: candidates.length === 0
      ? ['현재 진단 기준에서 이상 후보를 찾지 못했습니다. 정상임을 확정하는 결과는 아닙니다.']
      : ['움직임 후보는 카메라 이동과 피사체 이동을 완전히 구분하지 못할 수 있습니다.'],
  };
}
