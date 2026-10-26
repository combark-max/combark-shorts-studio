import { ipcMain } from 'electron';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipc';
import { diagnosticCandidateKey } from '../../shared/videoDiagnostics';
import {
  parseStabilizationPreviewRequest,
  type StabilizationPreviewProgress,
  type StabilizationPreviewRequest,
  type StabilizationPreviewResult,
} from '../../shared/videoStabilization';
import {
  MediaJobCoordinator,
  type MediaJobLease,
} from '../media-jobs/mediaJobCoordinator';
import { PreviewStore } from '../video-stabilization/previewStore';
import {
  assertConstantFrameRate,
  assertTransformRecordCount,
  buildConstantFrameRateCheckArgs,
  buildVidstabDetectArgs,
  buildVidstabTransformArgs,
  runStabilizationProcess,
  type StabilizationProcessCallbacks,
  type StabilizationProcessResult,
} from '../video-stabilization/ffmpegStabilization';
import { planStabilizationPreview } from '../video-stabilization/rangePlanning';
import { getPreviewStabilizationPreset } from '../video-stabilization/stabilizationPresets';
import type {
  VerifiedStabilizationPreview,
  VerifyStabilizationPreviewInput,
} from '../video-stabilization/verifyStabilizationPreview';
import {
  DiagnosticSessionStore,
  fingerprintSource,
  type RetainedDiagnosticSession,
  type SourceFingerprint,
} from './registerVideoDiagnosticsIpc';

export interface CreatedStabilizationPreview {
  directory: string;
  path: string;
  result: Omit<StabilizationPreviewResult, 'previewId' | 'previewPath'>;
}

export interface CreateStabilizationPreviewOptions {
  signal: AbortSignal;
  onProgress: (progress: StabilizationPreviewProgress) => void;
}

export type CreateStabilizationPreview = (
  request: StabilizationPreviewRequest,
  session: RetainedDiagnosticSession,
  options: CreateStabilizationPreviewOptions,
) => Promise<CreatedStabilizationPreview>;

export interface FfmpegStabilizationDependencies {
  ffmpegPath: string;
  makeTempDirectory?: () => Promise<string>;
  readTextFile?: (path: string) => Promise<string>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
  runProcess?: (
    ffmpegPath: string,
    args: string[],
    callbacks: StabilizationProcessCallbacks,
    signal?: AbortSignal,
  ) => Promise<StabilizationProcessResult>;
  verifyOutput: (
    input: VerifyStabilizationPreviewInput,
    signal?: AbortSignal,
  ) => Promise<VerifiedStabilizationPreview>;
}

export async function createFfmpegStabilizationPreview(
  request: StabilizationPreviewRequest,
  session: RetainedDiagnosticSession,
  options: CreateStabilizationPreviewOptions,
  dependencies: FfmpegStabilizationDependencies,
): Promise<CreatedStabilizationPreview> {
  const metadata = session.selected.metadata;
  if (metadata.fps === null || metadata.width === null || metadata.height === null) {
    throw new Error('안정화에 필요한 영상 메타데이터가 없습니다.');
  }
  const preset = request.strength === 'off'
    ? undefined
    : getPreviewStabilizationPreset(request.strength);
  options.onProgress({ stage: 'planning', percent: 0, processedFrames: null, totalFrames: null });
  const plan = planStabilizationPreview(request, {
    candidates: session.result.candidates,
    metadata,
    smoothingFrames: preset?.transform.smoothing ?? 0,
  });
  const candidate = session.result.candidates.find((value) =>
    diagnosticCandidateKey(value) === request.candidateKey);
  if (!candidate) throw new Error('선택한 진단 후보를 찾을 수 없습니다.');
  const makeTempDirectory = dependencies.makeTempDirectory ??
    (() => mkdtemp(join(tmpdir(), 'combark-stabilization-preview-')));
  const readTextFile = dependencies.readTextFile ?? ((path) => readFile(path, 'utf8'));
  const renameFile = dependencies.renameFile ?? rename;
  const removeDirectory = dependencies.removeDirectory ??
    ((path) => rm(path, { recursive: true, force: true }));
  const runProcess = dependencies.runProcess ?? runStabilizationProcess;
  const directory = await makeTempDirectory();
  const transformPath = join(directory, 'motions.trf');
  const pendingPath = join(directory, 'pending.mp4');
  const finalPath = join(directory, 'final.mp4');
  let succeeded = false;
  try {
    const window = {
      sourcePath: request.sourcePath,
      startFrame: plan.operation.analysisStartFrame,
      frameCount: plan.analysisFrameCount,
      fps: metadata.fps,
      width: metadata.width,
      height: metadata.height,
    };
    const cadence = await runProcess(
      dependencies.ffmpegPath,
      buildConstantFrameRateCheckArgs(window),
      {},
      options.signal,
    );
    assertConstantFrameRate(cadence.stderr);
    let transformRecordCount = 0;
    if (preset) {
      options.onProgress({
        stage: 'detecting', percent: 5, processedFrames: 0, totalFrames: window.frameCount,
      });
      const detection = await runProcess(dependencies.ffmpegPath, buildVidstabDetectArgs({
        window, transformPath, preset,
      }), {
        onProgressFrame: (frame) => options.onProgress({
          stage: 'detecting',
          percent: Math.min(45, Math.round(frame / window.frameCount * 40) + 5),
          processedFrames: frame,
          totalFrames: window.frameCount,
        }),
      }, options.signal);
      assertConstantFrameRate(detection.stderr);
      const transformContent = await readTextFile(transformPath);
      assertTransformRecordCount(transformContent, window.frameCount);
      transformRecordCount = window.frameCount;
    }

    const previewStartOffsetFrames = plan.previewStartFrame - window.startFrame;
    const previewEndOffsetFramesExclusive = plan.previewEndFrameExclusive - window.startFrame;
    options.onProgress({
      stage: 'transforming', percent: preset ? 50 : 10,
      processedFrames: 0, totalFrames: plan.previewFrameCount,
    });
    await runProcess(dependencies.ffmpegPath, buildVidstabTransformArgs({
      window,
      transformPath: preset ? transformPath : undefined,
      outputPath: pendingPath,
      preset,
      strength: request.strength,
      zoomPercent: request.zoomPercent,
      encoder: request.encoder,
      includeAudio: request.includeAudio && metadata.hasAudio === true,
      correctionStartOffsetFrames: plan.operation.correctionStartFrame - window.startFrame,
      correctionEndOffsetFramesExclusive: plan.operation.correctionEndFrameExclusive - window.startFrame,
      previewStartOffsetFrames,
      previewEndOffsetFramesExclusive,
    }), {
      onProgressFrame: (frame) => options.onProgress({
        stage: 'transforming',
        percent: Math.min(85, Math.round(frame / plan.previewFrameCount * 35) + 50),
        processedFrames: frame,
        totalFrames: plan.previewFrameCount,
      }),
    }, options.signal);

    options.onProgress({
      stage: 'verifying', percent: 90,
      processedFrames: null, totalFrames: plan.previewFrameCount,
    });
    const verified = await dependencies.verifyOutput({
      outputPath: pendingPath,
      expectedWidth: metadata.width,
      expectedHeight: metadata.height,
      expectedFps: metadata.fps,
      expectedFrameCount: plan.previewFrameCount,
      expectedAudio: request.includeAudio && metadata.hasAudio === true,
      transformRecordCount,
      expectedTransformRecordCount: preset ? plan.analysisFrameCount : 0,
      boundaryMode: plan.boundaryMode,
      joinFramesInPreview: plan.joinFramesInPreview,
      probeOutput: async () => { throw new Error('검증 probe가 구성되지 않았습니다.'); },
      decodeOutput: async () => { throw new Error('검증 decode가 구성되지 않았습니다.'); },
      analyzeBoundaryMotions: async () => [],
    }, options.signal);
    await renameFile(pendingPath, finalPath);
    succeeded = true;
    const warnings = [
      ...verified.boundaryAssessment.messages,
      ...(preset ? ['약하게/보통 강도 값은 실제 영상 검증 전의 시험 후보입니다.'] : []),
      ...(request.encoder === 'h264_qsv' ? ['Intel QSV 결과는 CPU 결과와 별도로 화질을 확인해야 합니다.'] : []),
    ];
    options.onProgress({
      stage: 'complete', percent: 100,
      processedFrames: plan.previewFrameCount, totalFrames: plan.previewFrameCount,
    });
    return {
      directory,
      path: finalPath,
      result: {
        sourceStartMs: Math.round(plan.previewStartFrame / metadata.fps * 1_000),
        sourceEndMs: Math.round(plan.previewEndFrameExclusive / metadata.fps * 1_000),
        durationMs: Math.round(plan.previewFrameCount / metadata.fps * 1_000),
        videoFrameCount: plan.previewFrameCount,
        hasAudio: verified.metadata.hasAudio,
        encoderUsed: request.encoder,
        manifest: {
          sourcePath: session.selected.sourcePath,
          sourceFileName: session.selected.fileName,
          candidateKey: diagnosticCandidateKey(candidate),
          candidateType: candidate.type,
          candidatePeakMs: candidate.peakMs,
          fps: metadata.fps,
          previewStartFrame: plan.previewStartFrame,
          previewEndFrameExclusive: plan.previewEndFrameExclusive,
          correctionStartFrame: plan.operation.correctionStartFrame,
          correctionEndFrameExclusive: plan.operation.correctionEndFrameExclusive,
          strength: request.strength,
          requestedZoomPercent: request.zoomPercent,
          appliedZoomPercent: request.strength === 'off' ? 0 : request.zoomPercent,
          encoder: request.encoder,
          selectionMode: request.selectionMode,
        },
        boundaryAssessment: verified.boundaryAssessment,
        warnings,
      },
    };
  } finally {
    if (!succeeded) await removeDirectory(directory);
  }
}

export interface RegisterVideoStabilizationIpcOptions {
  coordinator: MediaJobCoordinator;
  sessions: DiagnosticSessionStore;
  previewStore: PreviewStore;
  fingerprintSource?: (path: string) => Promise<SourceFingerprint>;
  createPreview?: CreateStabilizationPreview;
}

function equalFingerprint(left: SourceFingerprint, right: SourceFingerprint): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

const unconfiguredCreatePreview: CreateStabilizationPreview = async () => {
  throw new Error('안정화 FFmpeg 실행기가 구성되지 않았습니다.');
};

export function registerVideoStabilizationIpc(
  options: RegisterVideoStabilizationIpcOptions,
): void {
  const getFingerprint = options.fingerprintSource ?? fingerprintSource;
  const createPreview = options.createPreview ?? unconfiguredCreatePreview;
  const cleanupOwners = new WeakSet<object>();
  let activeJob: {
    sender: Electron.WebContents;
    controller: AbortController;
    lease: MediaJobLease;
  } | null = null;

  ipcMain.removeHandler(IPC_CHANNELS.videoStabilizationCancel);
  ipcMain.handle(IPC_CHANNELS.videoStabilizationCancel, (event): void => {
    if (activeJob?.sender === event.sender) activeJob.controller.abort();
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoStabilizationDispose);
  ipcMain.handle(IPC_CHANNELS.videoStabilizationDispose, async (event, previewId: unknown) => {
    if (typeof previewId !== 'string' || previewId.length === 0) return false;
    return options.previewStore.dispose(event.sender, previewId);
  });

  ipcMain.removeHandler(IPC_CHANNELS.videoStabilizationCreate);
  ipcMain.handle(IPC_CHANNELS.videoStabilizationCreate, async (event, value: unknown) => {
    const request = parseStabilizationPreviewRequest(value);
    const session = options.sessions.get(event.sender);
    if (!session || session.selected.sourcePath !== request.sourcePath) {
      throw new Error('현재 영상의 Phase 1 진단을 다시 실행해야 합니다.');
    }
    if (!session.result.candidates.some((candidate) =>
      diagnosticCandidateKey(candidate) === request.candidateKey)) {
      throw new Error('선택한 진단 후보가 최신 결과에 없습니다.');
    }
    const currentFingerprint = await getFingerprint(request.sourcePath);
    if (!equalFingerprint(currentFingerprint, session.fingerprint)) {
      throw new Error('원본 영상이 진단 후 변경되었습니다. Phase 1 진단을 다시 실행하세요.');
    }
    if (activeJob) throw new Error('안정화 시험 보정이 이미 진행 중입니다.');

    const controller = new AbortController();
    const lease = options.coordinator.tryAcquire(
      'stabilization-preview', event.sender, () => controller.abort(),
    );
    const handleDestroyed = (): void => controller.abort();
    let attachOwnerCleanup = false;
    activeJob = { sender: event.sender, controller, lease };
    event.sender.once('destroyed', handleDestroyed);
    try {
      const created = await createPreview(request, session, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.videoStabilizationProgress, progress);
          }
        },
      });
      const previewId = await options.previewStore.register(
        event.sender, created.directory, created.path,
      );
      if (!cleanupOwners.has(event.sender)) {
        cleanupOwners.add(event.sender);
        attachOwnerCleanup = true;
      }
      return {
        previewId,
        previewPath: created.path,
        ...created.result,
      } satisfies StabilizationPreviewResult;
    } finally {
      event.sender.removeListener('destroyed', handleDestroyed);
      if (attachOwnerCleanup) {
        event.sender.once('destroyed', () => {
          void options.previewStore.disposeOwner(event.sender);
        });
      }
      activeJob = null;
      lease.release();
    }
  });
}
