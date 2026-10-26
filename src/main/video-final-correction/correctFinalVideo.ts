import { access, link, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';

import type {
  VideoFinalCorrectionProgress,
  VideoFinalCorrectionRequest,
  VideoFinalCorrectionResult,
} from '../../shared/videoFinalCorrection';
import { parseFfmpegProbeOutput } from '../video-diagnostics/analyzeVideo';
import {
  assertConstantFrameRate,
  assertTransformRecordCount,
  buildVidstabDetectArgs,
  parseFfmpegFrameProgress,
  runStabilizationProcess,
  type StabilizationProcessCallbacks,
  type StabilizationProcessResult,
} from '../video-stabilization/ffmpegStabilization';
import { getFinalCorrectionPreset } from '../video-stabilization/stabilizationPresets';

export interface FinalCorrectionMediaMetadata {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationMs: number;
  sampleAspectRatio: string;
  displayAspectRatio: string;
  audioStreamCount: number;
  audioStreams: FinalCorrectionAudioStream[];
}

export interface FinalCorrectionAudioStream {
  codec: string;
  sampleRate: number | null;
  channelLayout: string | null;
  language: string | null;
  default: boolean;
}

export interface BuildFinalCorrectionTransformInput {
  request: VideoFinalCorrectionRequest;
  metadata: FinalCorrectionMediaMetadata;
  transformPath: string;
  pendingPath: string;
}

export type InspectFinalCorrectionMedia = (
  path: string,
  signal?: AbortSignal,
  onProgressFrame?: (frame: number) => void,
) => Promise<FinalCorrectionMediaMetadata>;

export interface FinalCorrectionDependencies {
  ffmpegPath: string;
  pathExists?: (path: string) => Promise<boolean>;
  makeTempDirectory?: () => Promise<string>;
  makePendingPath?: (outputPath: string) => string;
  inspectMedia?: InspectFinalCorrectionMedia;
  runProcess?: (
    ffmpegPath: string,
    args: string[],
    callbacks: StabilizationProcessCallbacks,
    signal?: AbortSignal,
  ) => Promise<StabilizationProcessResult>;
  readTextFile?: (path: string) => Promise<string>;
  publishFile?: (source: string, destination: string) => Promise<void>;
  assertPublishSupported?: (outputPath: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
  sourceFrameEstimate?: number;
  beforePublish?: () => Promise<void>;
  onProgress?: (progress: VideoFinalCorrectionProgress) => void;
}

function escapeFilterPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/([,;[\]])/g, '\\$1');
}

function sarExpression(value: string): string {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) throw new Error('원본 영상의 픽셀 종횡비를 확인할 수 없습니다.');
  return `${match[1]}/${match[2]}`;
}

export function buildFinalCorrectionTransformArgs(
  input: BuildFinalCorrectionTransformInput,
): string[] {
  const preset = getFinalCorrectionPreset(input.request.method);
  const transform = preset.transform;
  const filter = 'format=yuv420p,vidstabtransform=' + [
    `input='${escapeFilterPath(input.transformPath)}'`,
    `smoothing=${transform.smoothing}`,
    `interpol=${transform.interpol}`,
    `maxshift=${transform.maxshift}`,
    `maxangle=${transform.maxangleRadians}`,
    'tripod=0',
    'optzoom=0',
    'zoom=2',
    'crop=black',
  ].join(':') + `,setsar=${sarExpression(input.metadata.sampleAspectRatio)}`;
  return [
    '-n', '-hide_banner', '-nostdin', '-i', input.request.sourcePath,
    '-map', '0:v:0', '-map', '0:a?',
    '-vf', filter,
    '-frames:v', String(input.metadata.frameCount),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-map_metadata', '0', '-map_chapters', '0',
    '-movflags', '+faststart', '-progress', 'pipe:1', input.pendingPath,
  ];
}

export function parseFinalCorrectionMediaMetadata(
  stderr: string,
  stdout: string,
): FinalCorrectionMediaMetadata {
  const metadata = parseFfmpegProbeOutput(stderr);
  const frameCount = parseFfmpegFrameProgress(stdout);
  const inputInventory = stderr.split(/\r?\n\s*Stream mapping:/i)[0];
  const videoLine = inputInventory.split(/\r?\n/).find((line) => /Stream #\S+.*Video:/i.test(line));
  const aspect = videoLine?.match(/\[SAR\s+(\d+:\d+)\s+DAR\s+(\d+:\d+)\]/i);
  const audioStreams = inputInventory.split(/\r?\n/)
    .filter((line) => /^\s*Stream #0:\d+(?:\[[^\]]+\])?(?:\([^)]*\))?: Audio:/i.test(line))
    .map((line): FinalCorrectionAudioStream => {
      const language = line.match(/^\s*Stream #0:\d+(?:\[[^\]]+\])?\(([^)]+)\): Audio:/i)?.[1] ?? null;
      return {
        codec: line.match(/Audio:\s*([^,\s]+)/i)?.[1].toLocaleLowerCase('en-US') ?? 'unknown',
        sampleRate: Number(line.match(/,\s*(\d+)\s*Hz/i)?.[1]) || null,
        channelLayout: line.match(/,\s*\d+\s*Hz,\s*([^,]+)/i)?.[1].trim().toLocaleLowerCase('en-US') ?? null,
        language,
        default: /\(default\)/i.test(line),
      };
    });
  if (metadata.hasVideo !== true || metadata.width === null || metadata.height === null ||
      metadata.fps === null || metadata.durationMs === null || frameCount === null || !aspect) {
    throw new Error('영상의 프레임, 크기, FPS 또는 화면 비율을 확인할 수 없습니다.');
  }
  assertConstantFrameRate(stderr);
  return {
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    frameCount,
    durationMs: metadata.durationMs,
    sampleAspectRatio: aspect[1],
    displayAspectRatio: aspect[2],
    audioStreamCount: audioStreams.length,
    audioStreams,
  };
}

export function buildFinalCorrectionInspectionArgs(path: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-i', path,
    '-map', '0', '-vf', 'format=yuv420p,vfrdet',
    '-f', 'null', '-', '-progress', 'pipe:1', '-nostats',
  ];
}

export async function inspectFinalCorrectionMedia(
  path: string,
  ffmpegPath: string,
  runProcess = runStabilizationProcess,
  signal?: AbortSignal,
  onProgressFrame?: (frame: number) => void,
): Promise<FinalCorrectionMediaMetadata> {
  const result = await runProcess(
    ffmpegPath,
    buildFinalCorrectionInspectionArgs(path),
    { onProgressFrame },
    signal,
  );
  if (result.code !== 0) throw new Error('영상 전체를 디코드하여 검사하지 못했습니다.');
  return parseFinalCorrectionMediaMetadata(result.stderr, result.stdout);
}

function normalizedWindowsPath(path: string): string {
  return win32.normalize(path).toLocaleLowerCase('en-US');
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultPendingPath(outputPath: string): string {
  return join(dirname(outputPath), `.${basename(outputPath, '.mp4')}.${randomUUID()}.partial.mp4`);
}

export async function publishFinalCorrectionFile(
  pendingPath: string,
  outputPath: string,
  operations: {
    linkFile?: typeof link;
  } = {},
): Promise<void> {
  const linkFile = operations.linkFile ?? link;
  await linkFile(pendingPath, outputPath);
}

export async function assertAtomicPublicationSupported(
  outputPath: string,
  operations: {
    linkFile?: typeof link;
    removeFile?: (path: string) => Promise<void>;
  } = {},
): Promise<void> {
  const token = randomUUID();
  const directory = dirname(outputPath);
  const probePath = join(directory, `.combark-publish-probe-${token}.tmp`);
  const linkedPath = join(directory, `.combark-publish-probe-${token}.link.tmp`);
  const linkFile = operations.linkFile ?? link;
  const removeFile = operations.removeFile ?? ((path: string) => rm(path, { force: true }));
  let linkedCreated = false;
  try {
    const handle = await open(probePath, 'wx');
    await handle.close();
    await linkFile(probePath, linkedPath);
    linkedCreated = true;
  } catch (error) {
    const unsupported = new Error(
      '선택한 출력 위치는 기존 파일을 덮어쓰지 않는 안전한 게시를 지원하지 않습니다.',
    ) as Error & { cause?: unknown };
    unsupported.cause = error;
    throw unsupported;
  } finally {
    const cleanup = [removeFile(probePath)];
    if (linkedCreated) cleanup.push(removeFile(linkedPath));
    await Promise.allSettled(cleanup);
  }
}

function verifyMatchingMedia(
  source: FinalCorrectionMediaMetadata,
  output: FinalCorrectionMediaMetadata,
): void {
  if (output.width !== source.width || output.height !== source.height) {
    throw new Error('보정 결과의 해상도가 원본과 일치하지 않습니다.');
  }
  if (Math.abs(output.fps - source.fps) > 0.01) {
    throw new Error('보정 결과의 FPS가 원본과 일치하지 않습니다.');
  }
  if (output.frameCount !== source.frameCount) {
    throw new Error('보정 결과의 프레임 수가 원본과 일치하지 않습니다.');
  }
  if (output.sampleAspectRatio !== source.sampleAspectRatio ||
      output.displayAspectRatio !== source.displayAspectRatio) {
    throw new Error('보정 결과의 화면 비율이 원본과 일치하지 않습니다.');
  }
  if (output.audioStreamCount !== source.audioStreamCount) {
    throw new Error('보정 결과의 오디오 스트림 수가 원본과 일치하지 않습니다.');
  }
  if (JSON.stringify(output.audioStreams) !== JSON.stringify(source.audioStreams)) {
    throw new Error('보정 결과의 오디오 스트림 형식이 원본과 일치하지 않습니다.');
  }
  const frameDurationMs = 1_000 / source.fps;
  if (Math.abs(output.durationMs - source.durationMs) > frameDurationMs) {
    throw new Error('보정 결과의 영상 길이가 원본과 일치하지 않습니다.');
  }
}

function report(
  callback: FinalCorrectionDependencies['onProgress'],
  stage: VideoFinalCorrectionProgress['stage'],
  percent: number,
  processedFrames: number | null,
  totalFrames: number | null,
): void {
  callback?.({ stage, percent, processedFrames, totalFrames });
}

export async function correctFinalVideo(
  request: VideoFinalCorrectionRequest,
  dependencies: FinalCorrectionDependencies,
  signal?: AbortSignal,
): Promise<VideoFinalCorrectionResult> {
  if (normalizedWindowsPath(request.sourcePath) === normalizedWindowsPath(request.outputPath)) {
    throw new Error('원본 영상은 출력 파일로 덮어쓸 수 없습니다.');
  }
  if (!/\.mp4$/i.test(request.sourcePath) || !/\.mp4$/i.test(request.outputPath)) {
    throw new Error('입력과 출력은 MP4 파일이어야 합니다.');
  }
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  if (await pathExists(request.outputPath)) {
    throw new Error('출력 파일이 이미 존재합니다. 다른 이름을 선택하세요.');
  }
  const assertPublishSupported = dependencies.assertPublishSupported ?? assertAtomicPublicationSupported;
  await assertPublishSupported(request.outputPath);

  const execute = dependencies.runProcess ?? runStabilizationProcess;
  const inspect = dependencies.inspectMedia ?? ((path, inspectSignal, onProgressFrame) =>
    inspectFinalCorrectionMedia(path, dependencies.ffmpegPath, execute, inspectSignal, onProgressFrame));
  const makeDirectory = dependencies.makeTempDirectory ??
    (() => mkdtemp(join(tmpdir(), 'combark-final-correction-')));
  const makePendingPath = dependencies.makePendingPath ?? defaultPendingPath;
  const readText = dependencies.readTextFile ?? ((path) => readFile(path, 'utf8'));
  const publishFile = dependencies.publishFile ?? publishFinalCorrectionFile;
  const removeFile = dependencies.removeFile ?? ((path) => rm(path, { force: true }));
  const removeDirectory = dependencies.removeDirectory ??
    ((path) => rm(path, { recursive: true, force: true }));

  const sourceFrameEstimate = dependencies.sourceFrameEstimate;
  const validEstimate = typeof sourceFrameEstimate === 'number' &&
    Number.isSafeInteger(sourceFrameEstimate) && sourceFrameEstimate > 0
    ? sourceFrameEstimate
    : null;
  report(dependencies.onProgress, 'checking', 0, 0, validEstimate);
  const source = await inspect(request.sourcePath, signal, (frame) => report(
    dependencies.onProgress,
    'checking',
    validEstimate === null
      ? Math.min(9, Math.max(1, Math.floor(frame / 900) + 1))
      : Math.min(9, Math.round(frame / validEstimate * 9)),
    frame,
    validEstimate,
  ));
  if (source.frameCount <= 0 || source.fps <= 0) throw new Error('원본 영상 프레임 정보가 올바르지 않습니다.');
  const directory = await makeDirectory();
  const transformPath = join(directory, 'motions.trf');
  const pendingPath = makePendingPath(request.outputPath);
  const preset = getFinalCorrectionPreset(request.method);
  let completedResult: VideoFinalCorrectionResult | null = null;
  try {
    report(dependencies.onProgress, 'detecting', 10, 0, source.frameCount);
    await execute(dependencies.ffmpegPath, buildVidstabDetectArgs({
      window: {
        sourcePath: request.sourcePath,
        startFrame: 0,
        frameCount: source.frameCount,
        fps: source.fps,
        width: source.width,
        height: source.height,
      },
      transformPath,
      preset,
    }), {
      onProgressFrame: (frame) => report(
        dependencies.onProgress,
        'detecting',
        Math.min(50, 10 + Math.round(frame / source.frameCount * 40)),
        frame,
        source.frameCount,
      ),
    }, signal);
    assertTransformRecordCount(await readText(transformPath), source.frameCount);

    report(dependencies.onProgress, 'transforming', 50, 0, source.frameCount);
    await execute(dependencies.ffmpegPath, buildFinalCorrectionTransformArgs({
      request, metadata: source, transformPath, pendingPath,
    }), {
      onProgressFrame: (frame) => report(
        dependencies.onProgress,
        'transforming',
        Math.min(90, 50 + Math.round(frame / source.frameCount * 40)),
        frame,
        source.frameCount,
      ),
    }, signal);

    report(dependencies.onProgress, 'verifying', 90, 0, source.frameCount);
    const output = await inspect(pendingPath, signal, (frame) => report(
      dependencies.onProgress,
      'verifying',
      Math.min(98, 90 + Math.round(frame / source.frameCount * 8)),
      frame,
      source.frameCount,
    ));
    verifyMatchingMedia(source, output);
    await dependencies.beforePublish?.();
    if (await pathExists(request.outputPath)) {
      throw new Error('검증 중 출력 파일이 생성되었습니다. 기존 파일을 덮어쓰지 않습니다.');
    }
    report(dependencies.onProgress, 'publishing', 99, source.frameCount, source.frameCount);
    await publishFile(pendingPath, request.outputPath);
    report(dependencies.onProgress, 'complete', 100, source.frameCount, source.frameCount);
    completedResult = {
      sourcePath: request.sourcePath,
      outputPath: request.outputPath,
      method: request.method,
      width: output.width,
      height: output.height,
      fps: output.fps,
      frameCount: output.frameCount,
      durationMs: output.durationMs,
      audioStreamCount: output.audioStreamCount,
    };
  } catch (error) {
    await Promise.allSettled([removeFile(pendingPath), removeDirectory(directory)]);
    throw error;
  }
  await Promise.allSettled([removeFile(pendingPath), removeDirectory(directory)]);
  return completedResult;
}
