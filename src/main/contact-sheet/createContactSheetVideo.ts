import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  copyFile,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  CONTACT_SHEET_FPS_VALUES,
  CONTACT_SHEET_INTERPOLATION_MULTIPLIERS,
  CONTACT_SHEET_INTERPOLATION_VALUES,
  type ContactSheetFps,
  type ContactSheetInterpolation,
  type ContactSheetVideoProgress,
  type CreateContactSheetVideoRequest,
} from '../../shared/contactSheetVideo';
import {
  analyzeContactSheetBitmap,
  loadContactSheetImage,
  type ContactSheetAnalysis,
} from './analyzeContactSheet';

type RunFfmpeg = (
  ffmpegPath: string,
  args: string[],
  signal: AbortSignal,
) => Promise<void>;

export interface CreateContactSheetVideoDependencies {
  ffmpegPath: string;
  makeTempDirectory?: () => Promise<string>;
  writeFrame?: (path: string, data: Buffer) => Promise<void>;
  runFfmpeg?: RunFfmpeg;
  copyFile?: (source: string, destination: string) => Promise<void>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  removeFile?: (path: string) => Promise<void>;
  makeSiblingPath?: (
    outputPath: string,
    purpose: 'publish' | 'backup',
  ) => string;
  removeDirectory?: (path: string) => Promise<void>;
  onCleanupError?: (error: unknown) => void;
  onProgress?: (progress: ContactSheetVideoProgress) => void;
}

export interface PublishContactSheetOutputDependencies {
  copyFile: (source: string, destination: string) => Promise<void>;
  renameFile: (source: string, destination: string) => Promise<void>;
  pathExists: (path: string) => Promise<boolean>;
  removeFile: (path: string) => Promise<void>;
  makeSiblingPath: (
    outputPath: string,
    purpose: 'publish' | 'backup',
  ) => string;
  onCleanupError: (error: unknown) => void;
}

const SUPPORTED_IMAGE_PATH = /\.(?:jpe?g|png)$/i;

function abortError(): Error {
  const error = new Error('연속 프레임 영상 만들기가 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function validateRequest(request: CreateContactSheetVideoRequest): void {
  const ids = request?.sheets?.map((sheet) => sheet?.id) ?? [];
  if (
    !request ||
    !Array.isArray(request.sheets) ||
    request.sheets.length === 0 ||
    !CONTACT_SHEET_FPS_VALUES.includes(request.fps) ||
    (
      request.interpolation !== undefined &&
      !CONTACT_SHEET_INTERPOLATION_VALUES.includes(request.interpolation)
    ) ||
    request.sheets.some(
      (sheet) =>
        !sheet ||
        typeof sheet.id !== 'string' ||
        sheet.id.length === 0 ||
        typeof sheet.sourcePath !== 'string' ||
        !SUPPORTED_IMAGE_PATH.test(sheet.sourcePath) ||
        typeof sheet.fileName !== 'string' ||
        sheet.fileName.length === 0,
    ) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('유효하지 않은 contact sheet 영상 생성 요청입니다.');
  }
}

function loadAndAnalyze(sourcePath: string): ContactSheetAnalysis {
  return analyzeContactSheetBitmap(loadContactSheetImage(sourcePath).bitmap);
}

function defaultSiblingPath(
  outputPath: string,
  purpose: 'publish' | 'backup',
): string {
  return join(
    dirname(outputPath),
    `.${basename(outputPath)}.combark-${purpose}-${randomUUID()}.tmp`,
  );
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultCleanupReporter(error: unknown): void {
  console.warn('Contact-sheet temporary cleanup failed.', error);
}

async function cleanupWithoutMasking(
  path: string,
  removeFile: (path: string) => Promise<void>,
  onCleanupError: (error: unknown) => void,
): Promise<void> {
  try {
    await removeFile(path);
  } catch (error) {
    onCleanupError(error);
  }
}

export async function publishContactSheetOutput(
  finalPath: string,
  outputPath: string,
  dependencies: PublishContactSheetOutputDependencies,
  signal = new AbortController().signal,
): Promise<void> {
  const publishPath = dependencies.makeSiblingPath(outputPath, 'publish');
  const backupPath = dependencies.makeSiblingPath(outputPath, 'backup');
  let publishMoved = false;
  let outputBackedUp = false;

  try {
    throwIfAborted(signal);
    await dependencies.copyFile(finalPath, publishPath);
    throwIfAborted(signal);
    if (await dependencies.pathExists(outputPath)) {
      await dependencies.renameFile(outputPath, backupPath);
      outputBackedUp = true;
    }

    try {
      await dependencies.renameFile(publishPath, outputPath);
      publishMoved = true;
    } catch (publishError) {
      if (outputBackedUp) {
        try {
          await dependencies.renameFile(backupPath, outputPath);
          outputBackedUp = false;
        } catch (restoreError) {
          const recoveryError = new Error(
            `출력 파일 교체와 복구에 실패했습니다. 기존 파일은 ${backupPath}에 보존되어 있습니다.`,
          ) as Error & { failures: unknown[] };
          recoveryError.failures = [publishError, restoreError];
          throw recoveryError;
        }
      }
      throw publishError;
    }

    if (outputBackedUp) {
      await cleanupWithoutMasking(
        backupPath,
        dependencies.removeFile,
        dependencies.onCleanupError,
      );
      outputBackedUp = false;
    }
  } finally {
    if (!publishMoved) {
      await cleanupWithoutMasking(
        publishPath,
        dependencies.removeFile,
        dependencies.onCleanupError,
      );
    }
  }
}

export function buildContactSheetFfmpegArgs(
  inputPattern: string,
  frameCount: number,
  fps: ContactSheetFps,
  outputPath: string,
  interpolation?: ContactSheetInterpolation,
): string[] {
  if (interpolation) {
    const multiplier = CONTACT_SHEET_INTERPOLATION_MULTIPLIERS[interpolation];
    const outputFrameCount = frameCount * multiplier;
    return [
      '-y',
      '-framerate', String(fps),
      '-start_number', '0',
      '-i', inputPattern,
      '-vf',
      `setpts=${multiplier}*(PTS-STARTPTS),tpad=stop_mode=clone:stop=-1,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff:scd_threshold=10,trim=end_frame=${outputFrameCount}`,
      '-frames:v', String(outputFrameCount),
      '-an',
      '-c:v', 'libx264',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ];
  }

  return [
    '-y',
    '-framerate', String(fps),
    '-start_number', '0',
    '-i', inputPattern,
    '-frames:v', String(frameCount),
    '-an',
    '-c:v', 'libx264',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];
}

export function runContactSheetFfmpeg(
  ffmpegPath: string,
  args: string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let aborted = false;
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const handleAbort = (): void => {
      aborted = true;
      child.kill();
    };

    if (signal.aborted) {
      handleAbort();
    } else {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.on('error', (error) => {
      signal.removeEventListener('abort', handleAbort);
      reject(aborted ? abortError() : error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', handleAbort);
      if (aborted) {
        reject(abortError());
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `FFmpeg 실행에 실패했습니다 (${code ?? 'unknown'}). ${stderr.trim()}`,
        ));
      }
    });
  });
}

export async function createContactSheetVideo(
  request: CreateContactSheetVideoRequest,
  outputPath: string,
  dependencies: CreateContactSheetVideoDependencies,
  signal = new AbortController().signal,
): Promise<void> {
  validateRequest(request);
  throwIfAborted(signal);
  const reportProgress = dependencies.onProgress ?? (() => undefined);
  const analyses: ContactSheetAnalysis[] = [];

  for (const [index, sheet] of request.sheets.entries()) {
    throwIfAborted(signal);
    reportProgress({
      stage: 'analyzing',
      sheetIndex: index + 1,
      sheetCount: request.sheets.length,
    });
    analyses.push(loadAndAnalyze(sheet.sourcePath));
  }

  const minimumWidth = Math.min(
    ...analyses.flatMap((analysis) => analysis.frames.map((frame) => frame.width)),
  ) & ~1;
  const minimumHeight = Math.min(
    ...analyses.flatMap((analysis) => analysis.frames.map((frame) => frame.height)),
  ) & ~1;
  if (minimumWidth < 2 || minimumHeight < 2) {
    throw new Error('추출된 프레임 크기가 너무 작습니다.');
  }

  const makeTempDirectory = dependencies.makeTempDirectory ??
    (() => mkdtemp(join(tmpdir(), 'combark-contact-sheet-')));
  const writeFrame = dependencies.writeFrame ??
    ((path, data) => writeFile(path, data));
  const executeFfmpeg = dependencies.runFfmpeg ?? runContactSheetFfmpeg;
  const publishDependencies: PublishContactSheetOutputDependencies = {
    copyFile: dependencies.copyFile ?? copyFile,
    renameFile: dependencies.renameFile ?? rename,
    pathExists: dependencies.pathExists ?? defaultPathExists,
    removeFile: dependencies.removeFile ??
      ((path) => rm(path, { force: true })),
    makeSiblingPath: dependencies.makeSiblingPath ?? defaultSiblingPath,
    onCleanupError: dependencies.onCleanupError ?? defaultCleanupReporter,
  };
  const removeTempDirectory = dependencies.removeDirectory ??
    ((path) => rm(path, { recursive: true, force: true }));
  const tempDirectory = await makeTempDirectory();
  const totalFrameCount = request.sheets.length * 16;

  try {
    let frameIndex = 0;
    for (const sheet of request.sheets) {
      throwIfAborted(signal);
      const { image, bitmap } = loadContactSheetImage(sheet.sourcePath);
      const analysis = analyzeContactSheetBitmap(bitmap);

      for (const frame of analysis.frames) {
        throwIfAborted(signal);
        if (frame.width < minimumWidth || frame.height < minimumHeight) {
          throw new Error('contact sheet가 분석 후 변경되었습니다.');
        }
        reportProgress({
          stage: 'extracting',
          frameIndex: frameIndex + 1,
          frameCount: totalFrameCount,
        });
        const framePath = join(
          tempDirectory,
          `frame-${frameIndex.toString().padStart(6, '0')}.png`,
        );
        const png = image.crop({
          x: frame.x,
          y: frame.y,
          width: minimumWidth,
          height: minimumHeight,
        }).toPNG();
        await writeFrame(framePath, png);
        frameIndex += 1;
      }
    }

    throwIfAborted(signal);
    const finalPath = join(tempDirectory, 'final.mp4');
    reportProgress({ stage: 'encoding' });
    await executeFfmpeg(
      dependencies.ffmpegPath,
      buildContactSheetFfmpegArgs(
        join(tempDirectory, 'frame-%06d.png'),
        totalFrameCount,
        request.fps,
        finalPath,
        request.interpolation,
      ),
      signal,
    );
    throwIfAborted(signal);
    reportProgress({ stage: 'writing-output' });
    await publishContactSheetOutput(
      finalPath,
      outputPath,
      publishDependencies,
      signal,
    );
  } finally {
    try {
      await removeTempDirectory(tempDirectory);
    } catch (error) {
      publishDependencies.onCleanupError(error);
    }
  }
  reportProgress({ stage: 'complete' });
}
