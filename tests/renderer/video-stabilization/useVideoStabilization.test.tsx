import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVideoStabilization } from '../../../src/renderer/video-stabilization/useVideoStabilization';
import type { DiagnosticCandidate, SelectedDiagnosticVideo } from '../../../src/shared/videoDiagnostics';
import type { StabilizationPreviewManifest } from '../../../src/shared/videoStabilization';

const selected: SelectedDiagnosticVideo = {
  sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready',
  metadata: { durationMs: 20_000, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: true },
};
const candidate: DiagnosticCandidate = {
  type: 'motion-jitter', startMs: 7_900, endMs: 8_100, peakMs: 8_000,
  severity: 'medium', scoreMultiple: 2, scoreLabel: 'fixture', confidence: 'high',
};
const manifest: StabilizationPreviewManifest = {
  sourcePath: 'C:\\video.mp4', sourceFileName: 'video.mp4',
  candidateKey: 'motion-jitter:7900:8100:8000', candidateType: 'motion-jitter',
  candidatePeakMs: 8_000, fps: 30,
  previewStartFrame: 0, previewEndFrameExclusive: 150,
  correctionStartFrame: 0, correctionEndFrameExclusive: 150,
  strength: 'weak', requestedZoomPercent: 2, appliedZoomPercent: 2,
  encoder: 'libx264', selectionMode: 'range',
};

describe('useVideoStabilization', () => {
  beforeEach(() => {
    Object.assign(window, { combarkDesktop: {
      createStabilizationPreview: vi.fn(),
      cancelStabilizationPreview: vi.fn().mockResolvedValue(undefined),
      disposeStabilizationPreview: vi.fn().mockResolvedValue(true),
      onStabilizationPreviewProgress: vi.fn(() => vi.fn()),
    } });
  });

  it('starts with unconfirmed weak, 2%, CPU range settings', () => {
    const { result } = renderHook(() => useVideoStabilization(selected, candidate, vi.fn()));
    expect(result.current).toMatchObject({
      status: 'ready', strength: 'weak', zoomPercent: 2,
      encoder: 'libx264', selectionMode: 'range', sceneBoundaryConfirmed: false,
    });
    expect(result.current.requestedEndMs - result.current.requestedStartMs).toBe(5_000);
  });

  it('serializes explicit confirmation flags and stores only a successful result', async () => {
    const preview = { previewId: 'id', previewPath: 'C:\\Temp\\preview.mp4', sourceStartMs: 5_500, sourceEndMs: 10_500, durationMs: 5_000, videoFrameCount: 150, hasAudio: true, encoderUsed: 'libx264' as const, manifest, boundaryAssessment: { status: 'safe' as const, metrics: [], messages: [] }, warnings: [] };
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockResolvedValue(preview);
    const busy = vi.fn();
    const { result } = renderHook(() => useVideoStabilization(selected, candidate, busy));
    act(() => result.current.setSceneBoundaryConfirmed(true));
    await act(() => result.current.createPreview());
    expect(window.combarkDesktop.createStabilizationPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneBoundaryConfirmed: true, scaleMotionConfirmed: false,
        strength: 'weak', zoomPercent: 2, encoder: 'libx264',
      }),
    );
    expect(result.current.result).toBe(preview);
    expect(result.current.status).toBe('success');
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it('treats owner cancellation as retryable and disposes stale candidate results', async () => {
    const abort = new Error('canceled'); abort.name = 'AbortError';
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockRejectedValueOnce(abort);
    const { result, rerender } = renderHook(
      ({ value }) => useVideoStabilization(selected, value, vi.fn()),
      { initialProps: { value: candidate as DiagnosticCandidate | null } },
    );
    act(() => result.current.setSceneBoundaryConfirmed(true));
    await act(() => result.current.createPreview());
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();

    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockResolvedValueOnce({
      previewId: 'old', previewPath: 'C:\\Temp\\old.mp4', sourceStartMs: 0, sourceEndMs: 5_000,
      durationMs: 5_000, videoFrameCount: 150, hasAudio: true, encoderUsed: 'libx264',
      manifest,
      boundaryAssessment: { status: 'safe', metrics: [], messages: [] }, warnings: [],
    });
    await act(() => result.current.createPreview());
    rerender({ value: { ...candidate, peakMs: 9_000, startMs: 8_900, endMs: 9_100 } });
    await waitFor(() => expect(window.combarkDesktop.disposeStabilizationPreview).toHaveBeenCalledWith('old'));
    expect(result.current.result).toBeNull();
  });

  it('cancels an active request and cleans subscriptions on unmount', async () => {
    let finish: ((value: never) => void) | undefined;
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockReturnValue(
      new Promise((_, reject) => { finish = reject; }),
    );
    const removeProgress = vi.fn();
    vi.mocked(window.combarkDesktop.onStabilizationPreviewProgress).mockReturnValue(removeProgress);
    const { result, unmount } = renderHook(() => useVideoStabilization(selected, candidate, vi.fn()));
    act(() => result.current.setSceneBoundaryConfirmed(true));
    let pending: Promise<void>;
    act(() => { pending = result.current.createPreview(); });
    await waitFor(() => expect(result.current.status).toBe('running'));
    await act(() => result.current.cancel());
    expect(window.combarkDesktop.cancelStabilizationPreview).toHaveBeenCalledOnce();
    const abort = new Error('canceled'); abort.name = 'AbortError';
    finish?.(abort as never);
    if (pending) await act(() => pending);
    unmount();
    expect(removeProgress).toHaveBeenCalledOnce();
  });

  it('cancels an obsolete active request when the candidate changes', async () => {
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderHook(
      ({ value }) => useVideoStabilization(selected, value, vi.fn()),
      { initialProps: { value: candidate as DiagnosticCandidate | null } },
    );
    act(() => result.current.setSceneBoundaryConfirmed(true));
    act(() => { void result.current.createPreview(); });
    await waitFor(() => expect(result.current.status).toBe('running'));
    rerender({ value: { ...candidate, peakMs: 9_000, startMs: 8_900, endMs: 9_100 } });
    await waitFor(() => expect(window.combarkDesktop.cancelStabilizationPreview).toHaveBeenCalledOnce());
  });

  it('disposes a delayed old-source result even when the candidate key is unchanged', async () => {
    let resolvePreview: ((value: Awaited<ReturnType<typeof window.combarkDesktop.createStabilizationPreview>>) => void) | undefined;
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockReturnValue(
      new Promise((resolve) => { resolvePreview = resolve; }),
    );
    const otherSelected = { ...selected, sourcePath: 'C:\\other.mp4', fileName: 'other.mp4' };
    const { result, rerender } = renderHook(
      ({ video }) => useVideoStabilization(video, candidate, vi.fn()),
      { initialProps: { video: selected } },
    );
    act(() => result.current.setSceneBoundaryConfirmed(true));
    let pending: Promise<void>;
    act(() => { pending = result.current.createPreview(); });
    await waitFor(() => expect(result.current.status).toBe('running'));
    rerender({ video: otherSelected });
    resolvePreview?.({
      previewId: 'old-source', previewPath: 'C:\\Temp\\old.mp4',
      sourceStartMs: 0, sourceEndMs: 5_000, durationMs: 5_000,
      videoFrameCount: 150, hasAudio: true, encoderUsed: 'libx264',
      manifest: { ...manifest, sourcePath: 'C:\\other.mp4', sourceFileName: 'other.mp4' },
      boundaryAssessment: { status: 'safe', metrics: [], messages: [] }, warnings: [],
    });
    if (pending) await act(() => pending);
    expect(window.combarkDesktop.disposeStabilizationPreview).toHaveBeenCalledWith('old-source');
    expect(result.current.result).toBeNull();
  });
});
