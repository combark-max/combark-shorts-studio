import { useCallback, useEffect, useRef, useState } from 'react';

import type { StabilizationPreviewResult } from '../../shared/videoStabilization';
import type { VideoFinalCorrectionResult } from '../../shared/videoFinalCorrection';

export type StabilizationABVersion = 'original' | 'corrected';

export interface StabilizationABPlayback {
  originalRef: React.RefObject<HTMLVideoElement | null>;
  correctedRef: React.RefObject<HTMLVideoElement | null>;
  activeVersion: StabilizationABVersion;
  ready: boolean;
  switching: boolean;
  relativeTimeSeconds: number;
  message: string | null;
  switchVersion(next: StabilizationABVersion): void;
  onLoadedMetadata(version: StabilizationABVersion): void;
  onTimeUpdate(version: StabilizationABVersion): void;
  onPlay(version: StabilizationABVersion): void;
  onPause(version: StabilizationABVersion): void;
  onRateChange(version: StabilizationABVersion): void;
  onEnded(version: StabilizationABVersion): void;
}

interface Timing {
  sourceStartSeconds: number;
  commonDurationSeconds: number;
  frameDurationSeconds: number;
  lastComparableSeconds: number;
  compatible: boolean;
}

type ComparableStabilizationResult = StabilizationPreviewResult | VideoFinalCorrectionResult;

function timingFor(result: ComparableStabilizationResult | null): Timing {
  if (!result) {
    return {
      sourceStartSeconds: 0,
      commonDurationSeconds: 0,
      frameDurationSeconds: 0,
      lastComparableSeconds: 0,
      compatible: false,
    };
  }
  const isPreview = 'manifest' in result;
  const fps = isPreview ? result.manifest.fps : result.fps;
  const sourceStartFrame = isPreview ? result.manifest.previewStartFrame : 0;
  const sourceFrameCount = isPreview
    ? result.manifest.previewEndFrameExclusive - result.manifest.previewStartFrame
    : result.frameCount;
  const outputFrameCount = isPreview ? result.videoFrameCount : result.frameCount;
  const sourceDurationSeconds = sourceFrameCount / fps;
  const previewDurationSeconds = outputFrameCount / fps;
  const frameDurationSeconds = 1 / fps;
  const commonDurationSeconds = Math.min(sourceDurationSeconds, previewDurationSeconds);
  return {
    sourceStartSeconds: sourceStartFrame / fps,
    commonDurationSeconds,
    frameDurationSeconds,
    lastComparableSeconds: Math.max(0, commonDurationSeconds - frameDurationSeconds),
    compatible: Math.abs(sourceFrameCount - outputFrameCount) <= 1,
  };
}

function resultKey(result: ComparableStabilizationResult | null): string | null {
  if (!result) return null;
  return 'previewId' in result ? result.previewId : result.outputPath;
}

export function useStabilizationABPlayback(
  result: ComparableStabilizationResult | null,
): StabilizationABPlayback {
  const originalRef = useRef<HTMLVideoElement>(null);
  const correctedRef = useRef<HTMLVideoElement>(null);
  const [activeVersion, setActiveVersion] = useState<StabilizationABVersion>('original');
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [relativeTimeSeconds, setRelativeTimeSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const activeVersionRef = useRef<StabilizationABVersion>('original');
  const requestedVersionRef = useRef<StabilizationABVersion>('original');
  const relativeTimeRef = useRef(0);
  const shouldPlayRef = useRef(false);
  const playbackRateRef = useRef(1);
  const switchingRef = useRef(false);
  const generationRef = useRef(0);
  const metadataReadyRef = useRef({ original: false, corrected: false });
  const initializingRef = useRef(false);
  const pendingCleanupsRef = useRef<Array<() => void>>([]);
  const timing = timingFor(result);
  const timingRef = useRef(timing);
  timingRef.current = timing;

  const mediaFor = useCallback((version: StabilizationABVersion): HTMLVideoElement | null =>
    version === 'original' ? originalRef.current : correctedRef.current, []);

  const clearPending = useCallback((): void => {
    for (const cleanup of pendingCleanupsRef.current.splice(0)) cleanup();
  }, []);

  const nextGeneration = useCallback((): number => {
    generationRef.current += 1;
    clearPending();
    return generationRef.current;
  }, [clearPending]);

  const stopBoth = useCallback((): void => {
    for (const media of [originalRef.current, correctedRef.current]) {
      if (!media) continue;
      media.muted = true;
      media.pause();
    }
  }, []);

  const seek = useCallback((
    media: HTMLVideoElement,
    targetSeconds: number,
    generation: number,
    complete: () => void,
  ): void => {
    const epsilon = Math.max(timingRef.current.frameDurationSeconds / 2, 0.000_5);
    if (!media.seeking && Math.abs(media.currentTime - targetSeconds) <= epsilon) {
      media.currentTime = targetSeconds;
      complete();
      return;
    }
    let settled = false;
    const cleanup = (): void => {
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('error', onFailure);
      media.removeEventListener('emptied', onFailure);
      const index = pendingCleanupsRef.current.indexOf(cleanup);
      if (index >= 0) pendingCleanupsRef.current.splice(index, 1);
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (generation === generationRef.current) complete();
    };
    const onSeeked = (): void => finish();
    const onFailure = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (generation === generationRef.current) {
        stopBoth();
        switchingRef.current = false;
        setSwitching(false);
        setReady(false);
        setMessage('A/B 영상 위치를 맞추지 못했습니다. 다시 시도하세요.');
      }
    };
    pendingCleanupsRef.current.push(cleanup);
    media.addEventListener('seeked', onSeeked, { once: true });
    media.addEventListener('error', onFailure, { once: true });
    media.addEventListener('emptied', onFailure, { once: true });
    media.currentTime = targetSeconds;
  }, [stopBoth]);

  const finishAtLastFrame = useCallback((version: StabilizationABVersion): void => {
    const media = mediaFor(version);
    if (!media) return;
    const currentTiming = timingRef.current;
    relativeTimeRef.current = currentTiming.lastComparableSeconds;
    setRelativeTimeSeconds(currentTiming.lastComparableSeconds);
    shouldPlayRef.current = false;
    media.pause();
    media.currentTime = version === 'original'
      ? currentTiming.sourceStartSeconds + currentTiming.lastComparableSeconds
      : currentTiming.lastComparableSeconds;
  }, [mediaFor]);

  const initialize = useCallback((): void => {
    if (!result || initializingRef.current || ready ||
        !metadataReadyRef.current.original || !metadataReadyRef.current.corrected) return;
    if (!timingRef.current.compatible) {
      setMessage('원본과 보정본의 길이 차이가 한 프레임을 초과합니다.');
      return;
    }
    const original = originalRef.current;
    const corrected = correctedRef.current;
    if (!original || !corrected) return;
    initializingRef.current = true;
    stopBoth();
    const generation = generationRef.current;
    let remaining = 2;
    const completed = (): void => {
      remaining -= 1;
      if (remaining !== 0 || generation !== generationRef.current) return;
      initializingRef.current = false;
      activeVersionRef.current = 'original';
      requestedVersionRef.current = 'original';
      relativeTimeRef.current = 0;
      shouldPlayRef.current = false;
      playbackRateRef.current = original.playbackRate;
      original.muted = false;
      corrected.muted = true;
      setActiveVersion('original');
      setRelativeTimeSeconds(0);
      setReady(true);
    };
    seek(original, timingRef.current.sourceStartSeconds, generation, completed);
    seek(corrected, 0, generation, completed);
  }, [ready, result, seek, stopBoth]);

  useEffect(() => {
    nextGeneration();
    stopBoth();
    metadataReadyRef.current = { original: false, corrected: false };
    initializingRef.current = false;
    switchingRef.current = false;
    activeVersionRef.current = 'original';
    requestedVersionRef.current = 'original';
    relativeTimeRef.current = 0;
    shouldPlayRef.current = false;
    playbackRateRef.current = 1;
    setActiveVersion('original');
    setReady(false);
    setSwitching(false);
    setRelativeTimeSeconds(0);
    setMessage(null);
    const mediaElements = [originalRef.current, correctedRef.current];
    return () => {
      generationRef.current += 1;
      clearPending();
      for (const media of mediaElements) {
        if (!media) continue;
        media.muted = true;
        media.pause();
      }
    };
  }, [resultKey(result), clearPending, nextGeneration, stopBoth]);

  const onLoadedMetadata = useCallback((version: StabilizationABVersion): void => {
    metadataReadyRef.current[version] = true;
    initialize();
  }, [initialize]);

  const switchVersion = useCallback((next: StabilizationABVersion): void => {
    if (!result || !ready || next === requestedVersionRef.current) return;
    const current = mediaFor(activeVersionRef.current);
    const target = mediaFor(next);
    if (!current || !target) return;
    if (!switchingRef.current) {
      const relative = activeVersionRef.current === 'original'
        ? current.currentTime - timingRef.current.sourceStartSeconds
        : current.currentTime;
      relativeTimeRef.current = Math.max(
        0,
        Math.min(relative, timingRef.current.lastComparableSeconds),
      );
      setRelativeTimeSeconds(relativeTimeRef.current);
      shouldPlayRef.current = !current.paused;
      playbackRateRef.current = current.playbackRate;
    }
    requestedVersionRef.current = next;
    switchingRef.current = true;
    setSwitching(true);
    setMessage(null);
    const generation = nextGeneration();
    stopBoth();
    target.playbackRate = playbackRateRef.current;
    const targetSeconds = next === 'original'
      ? timingRef.current.sourceStartSeconds + relativeTimeRef.current
      : relativeTimeRef.current;
    seek(target, targetSeconds, generation, () => {
      if (generation !== generationRef.current) return;
      activeVersionRef.current = next;
      setActiveVersion(next);
      switchingRef.current = false;
      setSwitching(false);
      if (!shouldPlayRef.current) {
        target.muted = false;
        return;
      }
      void Promise.resolve(target.play()).then(() => {
        if (generation !== generationRef.current || activeVersionRef.current !== next) {
          return;
        }
        target.muted = false;
      }).catch(() => {
        if (generation !== generationRef.current || activeVersionRef.current !== next) {
          return;
        }
        target.pause();
        shouldPlayRef.current = false;
        target.muted = false;
        setMessage('자동 재생이 허용되지 않아 일시정지 상태로 전환했습니다.');
      });
    });
  }, [mediaFor, nextGeneration, ready, result, seek, stopBoth]);

  const onTimeUpdate = useCallback((version: StabilizationABVersion): void => {
    if (!ready || switchingRef.current || version !== activeVersionRef.current) return;
    const media = mediaFor(version);
    if (!media) return;
    const relative = version === 'original'
      ? media.currentTime - timingRef.current.sourceStartSeconds
      : media.currentTime;
    if (relative < 0) {
      relativeTimeRef.current = 0;
      setRelativeTimeSeconds(0);
      media.currentTime = version === 'original'
        ? timingRef.current.sourceStartSeconds
        : 0;
      return;
    }
    if (relative >= timingRef.current.commonDurationSeconds -
        timingRef.current.frameDurationSeconds / 2) {
      finishAtLastFrame(version);
      return;
    }
    relativeTimeRef.current = Math.max(0, Math.min(
      relative,
      timingRef.current.lastComparableSeconds,
    ));
    setRelativeTimeSeconds(relativeTimeRef.current);
  }, [finishAtLastFrame, mediaFor, ready]);

  const onPlay = useCallback((version: StabilizationABVersion): void => {
    if (switchingRef.current || version !== activeVersionRef.current) return;
    shouldPlayRef.current = true;
    const hidden = mediaFor(version === 'original' ? 'corrected' : 'original');
    if (hidden) {
      hidden.muted = true;
      hidden.pause();
    }
  }, [mediaFor]);

  const onPause = useCallback((version: StabilizationABVersion): void => {
    if (!switchingRef.current && version === activeVersionRef.current) {
      shouldPlayRef.current = false;
    }
  }, []);

  const onRateChange = useCallback((version: StabilizationABVersion): void => {
    if (switchingRef.current || version !== activeVersionRef.current) return;
    const media = mediaFor(version);
    if (media) playbackRateRef.current = media.playbackRate;
  }, [mediaFor]);

  const onEnded = useCallback((version: StabilizationABVersion): void => {
    if (version === activeVersionRef.current) finishAtLastFrame(version);
  }, [finishAtLastFrame]);

  return {
    originalRef,
    correctedRef,
    activeVersion,
    ready,
    switching,
    relativeTimeSeconds,
    message,
    switchVersion,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onPause,
    onRateChange,
    onEnded,
  };
}
