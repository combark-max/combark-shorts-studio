import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStabilizationABPlayback } from '../../../src/renderer/video-stabilization/useStabilizationABPlayback';
import type { StabilizationPreviewResult } from '../../../src/shared/videoStabilization';

const preview: StabilizationPreviewResult = {
  previewId: 'preview-one',
  previewPath: 'C:\\Temp\\preview.mp4',
  sourceStartMs: 5_500,
  sourceEndMs: 11_500,
  durationMs: 6_000,
  videoFrameCount: 180,
  hasAudio: true,
  encoderUsed: 'libx264',
  manifest: {
    sourcePath: 'C:\\video.mp4', sourceFileName: 'video.mp4',
    candidateKey: 'motion-jitter:7900:8100:8000', candidateType: 'motion-jitter',
    candidatePeakMs: 8_000, fps: 30,
    previewStartFrame: 165, previewEndFrameExclusive: 345,
    correctionStartFrame: 180, correctionEndFrameExclusive: 330,
    strength: 'weak', requestedZoomPercent: 2, appliedZoomPercent: 2,
    encoder: 'libx264', selectionMode: 'range',
  },
  boundaryAssessment: { status: 'safe', metrics: [], messages: [] },
  warnings: [],
};

interface ControlledMedia {
  element: HTMLVideoElement;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  setPaused(value: boolean): void;
}

function controlledMedia(): ControlledMedia {
  const element = document.createElement('video');
  let paused = true;
  Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
  const pause = vi.fn(() => { paused = true; });
  const play = vi.fn(async () => { paused = false; });
  Object.defineProperty(element, 'pause', { configurable: true, value: pause });
  Object.defineProperty(element, 'play', { configurable: true, value: play });
  return { element, pause, play, setPaused: (value) => { paused = value; } };
}

function setup(value: StabilizationPreviewResult = preview) {
  const hook = renderHook(
    ({ current }) => useStabilizationABPlayback(current),
    { initialProps: { current: value as StabilizationPreviewResult | null } },
  );
  const original = controlledMedia();
  const corrected = controlledMedia();
  hook.result.current.originalRef.current = original.element;
  hook.result.current.correctedRef.current = corrected.element;
  return { ...hook, original, corrected };
}

function finishInitialization(value: ReturnType<typeof setup>): void {
  act(() => value.result.current.onLoadedMetadata('corrected'));
  act(() => value.result.current.onLoadedMetadata('original'));
  act(() => value.original.element.dispatchEvent(new Event('seeked')));
}

function PlaybackHarness({ current }: { current: StabilizationPreviewResult | null }) {
  const playback = useStabilizationABPlayback(current);
  if (!current) return null;
  return <>
    <video
      data-testid="original"
      ref={playback.originalRef}
      onLoadedMetadata={() => playback.onLoadedMetadata('original')}
    />
    <video
      data-testid="corrected"
      ref={playback.correctedRef}
      onLoadedMetadata={() => playback.onLoadedMetadata('corrected')}
    />
  </>;
}

describe('useStabilizationABPlayback', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('waits for both metadata sources and seeks a non-zero source range before enabling comparison', () => {
    const value = setup();
    act(() => value.result.current.onLoadedMetadata('corrected'));
    expect(value.result.current.ready).toBe(false);
    act(() => value.result.current.onLoadedMetadata('original'));
    expect(value.original.element.currentTime).toBeCloseTo(5.5);
    expect(value.corrected.element.currentTime).toBe(0);
    expect(value.result.current.ready).toBe(false);
    act(() => value.original.element.dispatchEvent(new Event('seeked')));
    expect(value.result.current.ready).toBe(true);
    expect(value.result.current.activeVersion).toBe('original');
    expect(value.original.element.muted).toBe(false);
    expect(value.corrected.element.muted).toBe(true);
  });

  it('uses the manifest frame clock for the initial source seek', () => {
    const fractionalFpsPreview: StabilizationPreviewResult = {
      ...preview,
      sourceStartMs: 5_506,
      sourceEndMs: 11_512,
      durationMs: 6_006,
      manifest: {
        ...preview.manifest,
        fps: 30_000 / 1_001,
        previewStartFrame: 165,
        previewEndFrameExclusive: 345,
      },
    };
    const value = setup(fractionalFpsPreview);
    act(() => value.result.current.onLoadedMetadata('original'));
    act(() => value.result.current.onLoadedMetadata('corrected'));
    expect(value.original.element.currentTime).toBeCloseTo(5.5055, 6);
    expect(value.corrected.element.currentTime).toBe(0);
  });

  it.each([0.5, 1.5, 2])('keeps paused state, source time, and %sx speed on a round trip', (rate) => {
    const value = setup();
    finishInitialization(value);
    value.original.element.currentTime = 8;
    value.original.element.playbackRate = rate;
    act(() => value.result.current.onTimeUpdate('original'));
    act(() => value.result.current.onRateChange('original'));
    act(() => value.result.current.switchVersion('corrected'));
    expect(value.corrected.element.currentTime).toBeCloseTo(2.5);
    act(() => value.corrected.element.dispatchEvent(new Event('seeked')));
    expect(value.result.current.activeVersion).toBe('corrected');
    expect(value.corrected.element.playbackRate).toBe(rate);
    expect(value.corrected.play).not.toHaveBeenCalled();
    value.corrected.element.currentTime = 2.75;
    act(() => value.result.current.onTimeUpdate('corrected'));
    act(() => value.result.current.switchVersion('original'));
    act(() => value.original.element.dispatchEvent(new Event('seeked')));
    expect(value.original.element.currentTime).toBeCloseTo(8.25);
    expect(value.original.element.playbackRate).toBe(rate);
  });

  it('moves playback to the target only after its seek completes', async () => {
    const value = setup();
    finishInitialization(value);
    value.original.element.currentTime = 8;
    value.original.setPaused(false);
    act(() => value.result.current.onPlay('original'));
    act(() => value.result.current.switchVersion('corrected'));
    expect(value.original.pause).toHaveBeenCalled();
    expect(value.corrected.play).not.toHaveBeenCalled();
    await act(async () => value.corrected.element.dispatchEvent(new Event('seeked')));
    expect(value.corrected.play).toHaveBeenCalledOnce();
    expect(value.corrected.element.muted).toBe(false);
    expect(value.original.element.muted).toBe(true);
  });

  it('invalidates an older seek when the user switches back before it finishes', () => {
    const value = setup();
    finishInitialization(value);
    value.original.element.currentTime = 8;
    act(() => value.result.current.onTimeUpdate('original'));
    act(() => value.result.current.switchVersion('corrected'));
    act(() => value.result.current.switchVersion('original'));
    act(() => value.corrected.element.dispatchEvent(new Event('seeked')));
    expect(value.result.current.activeVersion).toBe('original');
    expect(value.corrected.element.muted).toBe(true);
    expect(value.corrected.play).not.toHaveBeenCalled();
  });

  it('waits for seeked when a rapid switch returns to a still-seeking target', () => {
    const value = setup();
    finishInitialization(value);
    value.original.element.currentTime = 8;
    act(() => value.result.current.onTimeUpdate('original'));
    let correctedSeeking = true;
    Object.defineProperty(value.corrected.element, 'seeking', {
      configurable: true,
      get: () => correctedSeeking,
    });
    act(() => value.result.current.switchVersion('corrected'));
    act(() => value.result.current.switchVersion('original'));
    act(() => value.result.current.switchVersion('corrected'));
    expect(value.result.current.activeVersion).toBe('original');
    expect(value.result.current.switching).toBe(true);
    expect(value.corrected.element.muted).toBe(true);
    correctedSeeking = false;
    act(() => value.corrected.element.dispatchEvent(new Event('seeked')));
    expect(value.result.current.activeVersion).toBe('corrected');
    expect(value.result.current.switching).toBe(false);
    expect(value.corrected.element.muted).toBe(false);
  });

  it('invalidates a stale play promise after a newer switch', async () => {
    const value = setup();
    finishInitialization(value);
    let resolvePlay: (() => void) | undefined;
    Object.defineProperty(value.corrected.element, 'play', {
      configurable: true,
      value: vi.fn(() => new Promise<void>((resolve) => { resolvePlay = resolve; })),
    });
    value.original.element.currentTime = 8;
    value.original.setPaused(false);
    act(() => value.result.current.onPlay('original'));
    act(() => value.result.current.switchVersion('corrected'));
    act(() => value.corrected.element.dispatchEvent(new Event('seeked')));
    act(() => value.result.current.switchVersion('original'));
    await act(async () => { resolvePlay?.(); await Promise.resolve(); });
    expect(value.result.current.activeVersion).toBe('original');
    expect(value.corrected.element.muted).toBe(true);
    expect(value.corrected.pause).toHaveBeenCalled();
  });

  it('does not let an old play promise pause the same player in a newer generation', async () => {
    const value = setup();
    finishInitialization(value);
    let resolveOldPlay: (() => void) | undefined;
    let playCalls = 0;
    Object.defineProperty(value.corrected.element, 'play', {
      configurable: true,
      value: vi.fn(() => {
        playCalls += 1;
        value.corrected.setPaused(false);
        if (playCalls === 1) {
          return new Promise<void>((resolve) => { resolveOldPlay = resolve; });
        }
        return Promise.resolve();
      }),
    });
    value.original.element.currentTime = 8;
    value.original.setPaused(false);
    act(() => value.result.current.onPlay('original'));
    act(() => value.result.current.switchVersion('corrected'));
    act(() => value.corrected.element.dispatchEvent(new Event('seeked')));
    act(() => value.result.current.switchVersion('original'));
    act(() => value.original.element.dispatchEvent(new Event('seeked')));
    value.original.setPaused(false);
    act(() => value.result.current.onPlay('original'));
    act(() => value.result.current.switchVersion('corrected'));
    await act(async () => {
      value.corrected.element.dispatchEvent(new Event('seeked'));
      await Promise.resolve();
    });
    const pausesBeforeOldResolution = value.corrected.pause.mock.calls.length;
    await act(async () => { resolveOldPlay?.(); await Promise.resolve(); });
    expect(value.result.current.activeVersion).toBe('corrected');
    expect(value.corrected.element.muted).toBe(false);
    expect(value.corrected.pause).toHaveBeenCalledTimes(pausesBeforeOldResolution);
  });

  it('stops at the last complete frame shared by one-frame-different streams', () => {
    const value = setup({ ...preview, durationMs: 6_033.333333333333, videoFrameCount: 181 });
    finishInitialization(value);
    value.original.element.currentTime = 11.499;
    value.original.setPaused(false);
    act(() => value.result.current.onTimeUpdate('original'));
    expect(value.original.pause).toHaveBeenCalled();
    expect(value.original.element.currentTime).toBeCloseTo(11.466666, 4);
    expect(value.result.current.relativeTimeSeconds).toBeCloseTo(5.966666, 4);
  });

  it('moves the original player back to the trial start after an earlier scrub', () => {
    const value = setup();
    finishInitialization(value);
    value.original.element.currentTime = 2;
    act(() => value.result.current.onTimeUpdate('original'));
    expect(value.original.element.currentTime).toBeCloseTo(5.5);
    expect(value.result.current.relativeTimeSeconds).toBe(0);
  });

  it('keeps playback paused and reports a rejected play request', async () => {
    const value = setup();
    finishInitialization(value);
    Object.defineProperty(value.corrected.element, 'play', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    value.original.element.currentTime = 8;
    value.original.setPaused(false);
    act(() => value.result.current.onPlay('original'));
    act(() => value.result.current.switchVersion('corrected'));
    await act(async () => { value.corrected.element.dispatchEvent(new Event('seeked')); await Promise.resolve(); });
    expect(value.corrected.pause).toHaveBeenCalled();
    expect(value.corrected.element.muted).toBe(false);
    expect(value.result.current.message).toMatch(/재생/);
  });

  it('pauses and mutes both players when the result is replaced or unmounted', () => {
    const value = setup();
    finishInitialization(value);
    value.rerender({ current: { ...preview, previewId: 'preview-two' } });
    expect(value.original.pause).toHaveBeenCalled();
    expect(value.corrected.pause).toHaveBeenCalled();
    expect(value.original.element.muted).toBe(true);
    expect(value.corrected.element.muted).toBe(true);
    value.unmount();
    expect(value.original.element.muted).toBe(true);
    expect(value.corrected.element.muted).toBe(true);
  });

  it('stops detached media elements when the result is discarded', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const view = render(<PlaybackHarness current={preview} />);
    const original = screen.getByTestId('original') as HTMLVideoElement;
    const corrected = screen.getByTestId('corrected') as HTMLVideoElement;
    fireEvent.loadedMetadata(original);
    fireEvent.loadedMetadata(corrected);
    fireEvent.seeked(original);
    pause.mockClear();
    original.muted = false;
    corrected.muted = false;
    view.rerender(<PlaybackHarness current={null} />);
    expect(pause).toHaveBeenCalledTimes(2);
    expect(original.muted).toBe(true);
    expect(corrected.muted).toBe(true);
  });
});
