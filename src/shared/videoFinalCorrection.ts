import type { VideoMetadata } from './videoDiagnostics';

export type VideoFinalCorrectionMethod = 'basic' | 'strong';

export interface VideoFinalCorrectionCapabilities {
  basic: true;
  strong: boolean;
}

export interface SelectedFinalCorrectionVideo {
  sourcePath: string;
  fileName: string;
  metadata: VideoMetadata;
  capabilities: VideoFinalCorrectionCapabilities;
}

export interface VideoFinalCorrectionRequest {
  sourcePath: string;
  outputPath: string;
  method: VideoFinalCorrectionMethod;
}

export interface VideoFinalCorrectionProgress {
  stage: 'checking' | 'detecting' | 'transforming' | 'verifying' | 'publishing' | 'complete';
  percent: number;
  processedFrames: number | null;
  totalFrames: number | null;
}

export interface VideoFinalCorrectionResult {
  sourcePath: string;
  outputPath: string;
  method: VideoFinalCorrectionMethod;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationMs: number;
  audioStreamCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseVideoFinalCorrectionRequest(value: unknown): VideoFinalCorrectionRequest {
  if (!isRecord(value)) throw new TypeError('영상 최종 보정 요청 형식이 올바르지 않습니다.');
  if (typeof value.sourcePath !== 'string' || value.sourcePath.length === 0 ||
      typeof value.outputPath !== 'string' || value.outputPath.length === 0) {
    throw new TypeError('영상 최종 보정 파일 경로가 올바르지 않습니다.');
  }
  if (value.method !== 'basic' && value.method !== 'strong') {
    throw new TypeError('지원하지 않는 영상 최종 보정 방식입니다.');
  }
  return {
    sourcePath: value.sourcePath,
    outputPath: value.outputPath,
    method: value.method,
  };
}
