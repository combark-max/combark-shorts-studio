import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVideoFinalCorrection } from '../../../src/renderer/video-final-correction/useVideoFinalCorrection';

const selected = {
  sourcePath: 'C:\\media\\source.mp4', fileName: 'source.mp4',
  metadata: { durationMs: 12_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
  capabilities: { basic: true as const, strong: false },
};
const outputPath = 'C:\\media\\source-corrected.mp4';
const corrected = {
  sourcePath: selected.sourcePath, outputPath, method: 'basic' as const,
  width: 1_080, height: 1_920, fps: 30, frameCount: 360,
  durationMs: 12_000, audioStreamCount: 1,
};

describe('useVideoFinalCorrection', () => {
  beforeEach(() => {
    Object.assign(window, { combarkDesktop: {
      selectFinalCorrectionVideo: vi.fn().mockResolvedValue(selected),
      selectFinalCorrectionOutput: vi.fn().mockResolvedValue(outputPath),
      startVideoFinalCorrection: vi.fn().mockResolvedValue(corrected),
      cancelVideoFinalCorrection: vi.fn().mockResolvedValue(undefined),
      onVideoFinalCorrectionProgress: vi.fn(() => vi.fn()),
    } });
  });

  it('selects an independent source and output while defaulting to basic', async () => {
    const busy = vi.fn();
    const { result } = renderHook(() => useVideoFinalCorrection(busy));
    await act(() => result.current.selectVideo());
    await act(() => result.current.selectOutput());
    expect(result.current).toMatchObject({ selected, outputPath, method: 'basic', status: 'ready' });
    expect(window.combarkDesktop.selectFinalCorrectionOutput).toHaveBeenCalledWith(selected.sourcePath);
    expect(busy.mock.calls.slice(0, 2)).toEqual([[true], [false]]);
  });

  it('treats a resolved correction as success when cancel races with publication', async () => {
    let resolveJob: ((value: typeof corrected) => void) | undefined;
    vi.mocked(window.combarkDesktop.startVideoFinalCorrection).mockReturnValue(
      new Promise((resolve) => { resolveJob = resolve; }),
    );
    const { result } = renderHook(() => useVideoFinalCorrection(vi.fn()));
    await act(() => result.current.selectVideo());
    await act(() => result.current.selectOutput());
    let pending: Promise<void>;
    act(() => { pending = result.current.start(); });
    await waitFor(() => expect(result.current.status).toBe('running'));
    await act(() => result.current.cancel());
    resolveJob?.(corrected);
    if (pending) await act(() => pending);
    expect(result.current.status).toBe('success');
    expect(result.current.result).toBe(corrected);
  });

  it('requires a new destination when changing method after success', async () => {
    const strongSelected = { ...selected, capabilities: { basic: true as const, strong: true } };
    vi.mocked(window.combarkDesktop.selectFinalCorrectionVideo).mockResolvedValue(strongSelected);
    const { result } = renderHook(() => useVideoFinalCorrection(vi.fn()));
    await act(() => result.current.selectVideo());
    await act(() => result.current.selectOutput());
    await act(() => result.current.start());
    act(() => result.current.setMethod('strong'));
    expect(result.current.outputPath).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('forwards progress, locks other work, and retains a successful output for comparison', async () => {
    const removeProgress = vi.fn();
    vi.mocked(window.combarkDesktop.onVideoFinalCorrectionProgress).mockImplementation((listener) => {
      listener({ stage: 'detecting', percent: 25, processedFrames: 90, totalFrames: 360 });
      return removeProgress;
    });
    const busy = vi.fn();
    const { result } = renderHook(() => useVideoFinalCorrection(busy));
    await act(() => result.current.selectVideo());
    await act(() => result.current.selectOutput());
    await act(() => result.current.start());
    expect(window.combarkDesktop.startVideoFinalCorrection).toHaveBeenCalledWith({
      sourcePath: selected.sourcePath, outputPath, method: 'basic',
    });
    expect(result.current.progress).toMatchObject({ stage: 'detecting', percent: 25 });
    expect(result.current.result).toBe(corrected);
    expect(result.current.status).toBe('success');
    expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
    expect(removeProgress).toHaveBeenCalledOnce();
  });

  it('cancels a running job and returns to a retryable state', async () => {
    let rejectJob: ((error: Error) => void) | undefined;
    vi.mocked(window.combarkDesktop.startVideoFinalCorrection).mockReturnValue(
      new Promise((_resolve, reject) => { rejectJob = reject; }),
    );
    const { result } = renderHook(() => useVideoFinalCorrection(vi.fn()));
    await act(() => result.current.selectVideo());
    await act(() => result.current.selectOutput());
    let pending: Promise<void>;
    act(() => { pending = result.current.start(); });
    await waitFor(() => expect(result.current.status).toBe('running'));
    await act(() => result.current.cancel());
    const abort = new Error('canceled'); abort.name = 'AbortError';
    rejectJob?.(abort);
    if (pending) await act(() => pending);
    expect(window.combarkDesktop.cancelVideoFinalCorrection).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });
});
