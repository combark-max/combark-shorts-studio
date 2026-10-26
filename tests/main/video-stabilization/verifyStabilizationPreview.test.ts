import { describe, expect, it, vi } from 'vitest';

import {
  assessStabilizationBoundaries,
  parseDecodedStabilizationMetadata,
  verifyStabilizationPreview,
  verifyStabilizationPreviewWithFfmpeg,
  StabilizationVerificationError,
  type BoundaryMotionWindow,
  type StabilizationOutputMetadata,
} from '../../../src/main/video-stabilization/verifyStabilizationPreview';
import type { EstimatedFrameMotion } from '../../../src/main/video-diagnostics/analyzeVideo';

const metadata: StabilizationOutputMetadata = {
  hasVideo: true,
  hasAudio: true,
  width: 1_080,
  height: 1_920,
  fps: 30,
  videoFrameCount: 180,
  videoLastPtsMs: 5_966.667,
  videoDurationMs: 6_000,
  audioDurationMs: 6_000,
};

const baseInput = {
  outputPath: 'C:\\Temp\\preview.mp4',
  expectedWidth: 1_080,
  expectedHeight: 1_920,
  expectedFps: 30,
  expectedFrameCount: 180,
  expectedAudio: true,
  transformRecordCount: 200,
  expectedTransformRecordCount: 200,
  boundaryMode: 'exposed-handles' as const,
  probeOutput: vi.fn().mockResolvedValue(metadata),
  decodeOutput: vi.fn().mockResolvedValue(undefined),
  analyzeBoundaryMotions: vi.fn().mockResolvedValue([]),
};

describe('verifyStabilizationPreview', () => {
  it('parses a real 180-frame FFmpeg null decode as last PTS plus one frame of duration', () => {
    const parsed = parseDecodedStabilizationMetadata(
      'Input #0, mov, from preview.mp4:\n  Duration: 00:00:06.00\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n  Stream #0:1: Audio: aac, 48000 Hz, stereo',
      'frame=180\nfps=0.00\nout_time_us=5966667\nout_time_ms=5966667\nout_time=00:00:05.966667\nprogress=end\n',
    );
    expect(parsed).toEqual({
      hasVideo: true, hasAudio: true, width: 1080, height: 1920, fps: 30,
      videoFrameCount: 180, videoLastPtsMs: 5_966.667,
      videoDurationMs: 6_000, audioDurationMs: 5_966.667,
    });
  });

  it('accepts the real 181-frame regression output whose last PTS is 6000ms', async () => {
    const parsed = parseDecodedStabilizationMetadata(
      'Input #0, mov, from preview.mp4:\n  Duration: 00:00:06.04\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps',
      'frame=181\nfps=0.00\nout_time_us=6000000\nout_time_ms=6000000\nout_time=00:00:06.000000\nprogress=end\n',
    );
    await expect(verifyStabilizationPreview({
      ...baseInput,
      expectedFrameCount: 181,
      expectedAudio: false,
      probeOutput: vi.fn().mockResolvedValue(parsed),
    })).resolves.toMatchObject({
      metadata: {
        videoFrameCount: 181,
        videoLastPtsMs: 6_000,
        videoDurationMs: 6_033.333333333333,
      },
    });
  });

  it('rejects 181 frames when the last PTS ends one frame early', async () => {
    await expect(verifyStabilizationPreview({
      ...baseInput,
      expectedFrameCount: 181,
      expectedAudio: false,
      probeOutput: vi.fn().mockResolvedValue({
        ...metadata,
        videoFrameCount: 181,
        videoLastPtsMs: 5_966.667,
        videoDurationMs: 6_033.333333333333,
      }),
    })).rejects.toThrow('길이');
  });

  it('validates last PTS and total duration at a non-integer frame rate', async () => {
    const fps = 30_000 / 1_001;
    const parsed = parseDecodedStabilizationMetadata(
      `Input #0, mov, from preview.mp4:\n  Duration: 00:00:06.01\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, ${fps} fps`,
      'frame=180\nout_time_us=5972633\nout_time_ms=5972633\nprogress=end\n',
    );
    await expect(verifyStabilizationPreview({
      ...baseInput,
      expectedFps: fps,
      expectedFrameCount: 180,
      expectedAudio: false,
      probeOutput: vi.fn().mockResolvedValue(parsed),
    })).resolves.toMatchObject({
      metadata: { videoLastPtsMs: 5_972.633, videoDurationMs: 6_006 },
    });
  });

  it('accepts exact frame, duration, dimension, decode, and audio timing', async () => {
    await expect(verifyStabilizationPreview(baseInput)).resolves.toMatchObject({
      metadata,
      boundaryAssessment: { status: 'unverifiable' },
    });
  });

  it.each([
    [{ ...metadata, hasVideo: false }, '영상'],
    [{ ...metadata, width: 720 }, '크기'],
    [{ ...metadata, fps: 29.5 }, 'FPS'],
    [{ ...metadata, videoFrameCount: 179 }, '프레임'],
    [{ ...metadata, videoLastPtsMs: 5_900, videoDurationMs: 5_933.333333333333 }, '길이'],
    [{ ...metadata, audioDurationMs: 6_100 }, '동기'],
  ])('rejects invalid output metadata %#', async (actual, message) => {
    await expect(verifyStabilizationPreview({
      ...baseInput,
      probeOutput: vi.fn().mockResolvedValue(actual),
    })).rejects.toThrow(message);
  });

  it('rejects decode and transform insufficiency as fatal', async () => {
    await expect(verifyStabilizationPreview({
      ...baseInput,
      decodeOutput: vi.fn().mockRejectedValue(new Error('corrupt')),
    })).rejects.toBeInstanceOf(StabilizationVerificationError);
    await expect(verifyStabilizationPreview({
      ...baseInput,
      transformRecordCount: 199,
    })).rejects.toThrow('transform');
  });

  it('decodes audio separately and rejects stream-specific A/V drift', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        stderr: 'Input #0, mov\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps',
        stdout: 'frame=180\nout_time_us=5966667\nout_time_ms=5966667\nprogress=end\n',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: 'Input #0, mov\n  Stream #0:1: Audio: aac, 48000 Hz, stereo',
        stdout: 'out_time_ms=5800000\nprogress=end\n',
      });
    await expect(verifyStabilizationPreviewWithFfmpeg({
      ...baseInput,
      boundaryMode: 'scene-cuts',
    }, 'C:\\ffmpeg.exe', undefined, { runProcess })).rejects.toThrow('동기');
    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(runProcess.mock.calls[0][1]).toEqual(expect.arrayContaining(['-map', '0:v:0', '-an']));
    expect(runProcess.mock.calls[1][1]).toEqual(expect.arrayContaining(['-map', '0:a:0', '-vn']));
  });
});

describe('assessStabilizationBoundaries', () => {
  it('protects scene cuts without analyzing across them', () => {
    expect(assessStabilizationBoundaries('scene-cuts', [])).toEqual({
      status: 'protected-scene-cut', metrics: [], messages: [],
    });
  });

  it('reports safe, warning, and unverifiable joins', () => {
    const safe = window('start', [motion(1, 0), motion(1, 0), motion(1, 0)], [
      motion(1.01, 0), motion(1.01, 0), motion(1.01, 0),
    ]);
    const warning = window('end', [motion(0, 0), motion(0, 0), motion(0, 0)], [
      motion(5, 1), motion(5, 1), motion(5, 1),
    ]);
    expect(assessStabilizationBoundaries('exposed-handles', [safe]).status).toBe('safe');
    expect(assessStabilizationBoundaries('exposed-handles', [warning]).status).toBe('warning');
    expect(assessStabilizationBoundaries('exposed-handles', [
      window('start', [motion(0, 0)], [motion(0, 0)]),
    ]).status).toBe('unverifiable');
    const medium = assessStabilizationBoundaries('exposed-handles', [
      window('end', [motion(0, 0, 'medium'), motion(0, 0), motion(0, 0)], [
        motion(0, 0), motion(0, 0), motion(0, 0),
      ]),
    ]);
    expect(medium.status).toBe('unverifiable');
    expect(medium.metrics[0].confidence).toBe('medium');
  });
});

function motion(
  translationX: number,
  rotationDegrees: number,
  confidence: EstimatedFrameMotion['translationConfidence'] = 'high',
): EstimatedFrameMotion {
  return {
    frameNumber: 1,
    translationX,
    translationY: 0,
    rotationDegrees,
    scalePercent: 0,
    translationConfidence: confidence,
    uncertaintyCode: null,
    similarityUncertaintyCode: null,
    analysisDiagonal: 1_000,
  };
}

function window(
  join: BoundaryMotionWindow['join'],
  before: EstimatedFrameMotion[],
  after: EstimatedFrameMotion[],
): BoundaryMotionWindow {
  return { join, before, after };
}
