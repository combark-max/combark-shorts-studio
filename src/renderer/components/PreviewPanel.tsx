import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import type {
  MediaAsset,
  NarrationAsset,
  Scene,
} from '../../shared/project/types';
import { getSubtitleStyle } from '../../shared/project/subtitleStyle';
import {
  buildPreviewTimeline,
  locatePreviewTime,
} from '../project/previewTimeline';

interface PreviewPanelProps {
  media: MediaAsset[];
  narration: NarrationAsset | null;
  scenes: Scene[];
  selectedSceneIndex: number | null;
  onSelectScene: (sceneIndex: number) => void;
}

type MediaError = 'load' | 'play' | null;
type NarrationError = 'load' | 'play' | null;

interface VideoDurationEntry {
  sourcePath: string;
  durationMs: number | null;
}

interface PendingSeek {
  sceneIndex: number;
  sceneLocalTimeMs: number;
  globalTimeMs: number;
  mediaId: string;
  sourcePath: string;
}

function readMediaDurationMs(element: HTMLMediaElement): number | null {
  return Number.isFinite(element.duration) && element.duration > 0
    ? Math.round(element.duration * 1000)
    : null;
}

function formatPreviewTime(durationMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function PreviewPanel({
  media,
  narration,
  scenes,
  selectedSceneIndex,
  onSelectScene,
}: PreviewPanelProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaError, setMediaError] = useState<MediaError>(null);
  const [narrationError, setNarrationError] =
    useState<NarrationError>(null);
  const [narrationEnded, setNarrationEnded] = useState(false);
  const [playbackRestartToken, setPlaybackRestartToken] = useState(0);
  const [globalCurrentTimeMs, setGlobalCurrentTimeMs] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [videoDurationEntries, setVideoDurationEntries] = useState<
    Record<string, VideoDurationEntry>
  >({});
  const [narrationDurationMs, setNarrationDurationMs] = useState<
    number | null | undefined
  >(undefined);
  const remainingImageMsRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<PendingSeek | null>(null);
  const pendingNarrationSeekMsRef = useRef<number | null>(null);
  const automaticSceneChangeRef = useRef(false);
  const activeVideoMetadataReadyRef = useRef(false);
  const readyVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const readyVideoSourcePathRef = useRef<string | null>(null);
  const awaitingTimelinePositionRef = useRef(false);
  const imageTimerResetRef = useRef(false);
  const imageTimerStartedAtRef = useRef<number | null>(null);
  const imageTimerStartingRemainingMsRef = useRef(0);
  const mediaById = useMemo(
    () => new Map(media.map((asset) => [asset.id, asset])),
    [media],
  );
  const videoAssets = useMemo(() => {
    const assets = new Map<string, MediaAsset>();
    for (const scene of scenes) {
      const asset = mediaById.get(scene.mediaId);
      if (asset?.kind === 'video') {
        assets.set(asset.id, asset);
      }
    }
    return [...assets.values()];
  }, [mediaById, scenes]);
  const videoDurationMsByMediaId = useMemo(
    () =>
      Object.fromEntries(
        videoAssets.map((asset) => {
          const entry = videoDurationEntries[asset.id];
          return [
            asset.id,
            entry?.sourcePath === asset.sourcePath ? entry.durationMs : undefined,
          ];
        }),
      ),
    [videoAssets, videoDurationEntries],
  );
  const previewTimeline = useMemo(
    () =>
      buildPreviewTimeline(scenes, media, videoDurationMsByMediaId),
    [media, scenes, videoDurationMsByMediaId],
  );

  const currentIndex =
    selectedSceneIndex !== null &&
    Number.isInteger(selectedSceneIndex) &&
    selectedSceneIndex >= 0 &&
    selectedSceneIndex < scenes.length
      ? selectedSceneIndex
      : -1;
  const currentScene = currentIndex >= 0 ? scenes[currentIndex] : null;
  const currentAsset =
    media.find(({ id }) => id === currentScene?.mediaId) ?? null;
  const subtitleStyle = currentScene
    ? getSubtitleStyle(currentScene.subtitlePosition, currentScene.subtitleSize)
    : null;
  const previewSubtitleStyle: CSSProperties | undefined = subtitleStyle
    ? {
        fontSize: `${subtitleStyle.normalizedFontSize * 100}cqw`,
        left: `${subtitleStyle.normalizedHorizontalMargin * 100}%`,
        right: `${subtitleStyle.normalizedHorizontalMargin * 100}%`,
        ...(currentScene?.subtitlePosition === 'top'
          ? { top: `${subtitleStyle.normalizedVerticalMargin * 100}%` }
          : currentScene?.subtitlePosition === 'center'
            ? { top: '50%', transform: 'translateY(-50%)' }
            : { bottom: `${subtitleStyle.normalizedVerticalMargin * 100}%` }),
      }
    : undefined;

  const currentSceneTiming = previewTimeline?.scenes[currentIndex] ?? null;
  const currentSceneStartMs = currentSceneTiming?.startMs ?? null;

  const applyNarrationSeek = (
    globalTimeMs: number,
    knownDurationMs = narrationDurationMs,
  ): void => {
    if (!narration || !audioRef.current) {
      pendingNarrationSeekMsRef.current = null;
      return;
    }

    if (typeof knownDurationMs !== 'number') {
      pendingNarrationSeekMsRef.current = globalTimeMs;
      return;
    }

    const audioTimeMs = Math.min(globalTimeMs, knownDurationMs);
    try {
      audioRef.current.currentTime = audioTimeMs / 1000;
      pendingNarrationSeekMsRef.current = null;
      setNarrationEnded(globalTimeMs >= knownDurationMs);
    } catch {
      pendingNarrationSeekMsRef.current = globalTimeMs;
    }
  };

  const applyPendingVideoSeek = (video: HTMLVideoElement): boolean => {
    const pendingSeek = pendingSeekRef.current;
    if (!pendingSeek || pendingSeek.sceneIndex !== currentIndex) {
      return false;
    }

    try {
      video.currentTime = pendingSeek.sceneLocalTimeMs / 1000;
      pendingSeekRef.current = null;
      return true;
    } catch {
      return false;
    }
  };

  const storeVideoDuration = (
    asset: MediaAsset,
    durationMs: number | null,
  ): void => {
    setVideoDurationEntries((entries) => {
      const currentEntry = entries[asset.id];
      return currentEntry?.sourcePath === asset.sourcePath &&
        currentEntry.durationMs === durationMs
        ? entries
        : {
            ...entries,
            [asset.id]: { sourcePath: asset.sourcePath, durationMs },
          };
    });
  };

  useEffect(() => {
    setMediaError(null);
    let pendingSeek = pendingSeekRef.current;
    if (
      pendingSeek &&
      (pendingSeek.sceneIndex !== currentIndex ||
        pendingSeek.mediaId !== currentAsset?.id ||
        pendingSeek.sourcePath !== currentAsset?.sourcePath)
    ) {
      pendingSeekRef.current = null;
      pendingSeek = null;
    }
    if (
      pendingSeek &&
      pendingSeek.sceneIndex === currentIndex &&
      currentAsset?.kind === 'image' &&
      currentScene?.durationMs
    ) {
      remainingImageMsRef.current = Math.max(
        0,
        currentScene.durationMs - pendingSeek.sceneLocalTimeMs,
      );
      pendingSeekRef.current = null;
    } else {
      remainingImageMsRef.current = currentScene?.durationMs ?? 0;
    }
    if (currentAsset?.kind === 'image') {
      imageTimerStartingRemainingMsRef.current = remainingImageMsRef.current;
    }
    if (currentAsset?.kind === 'video' && videoRef.current) {
      activeVideoMetadataReadyRef.current =
        readyVideoElementRef.current === videoRef.current &&
        readyVideoSourcePathRef.current === currentAsset.sourcePath;
      if (pendingSeek?.sceneIndex === currentIndex) {
        if (
          activeVideoMetadataReadyRef.current &&
          applyPendingVideoSeek(videoRef.current)
        ) {
          setSeekRevision((revision) => revision + 1);
        }
      } else {
        videoRef.current.currentTime = 0;
      }
    } else {
      activeVideoMetadataReadyRef.current = false;
    }

    if (currentSceneTiming) {
      awaitingTimelinePositionRef.current = false;
      if (pendingSeek && pendingSeek.sceneIndex === currentIndex) {
        setGlobalCurrentTimeMs(pendingSeek.globalTimeMs);
      } else {
        setGlobalCurrentTimeMs(currentSceneTiming.startMs);
        if (!automaticSceneChangeRef.current) {
          applyNarrationSeek(currentSceneTiming.startMs);
        }
      }
    } else {
      awaitingTimelinePositionRef.current = true;
      setGlobalCurrentTimeMs(0);
    }
    automaticSceneChangeRef.current = false;

    if (!currentScene || !currentAsset) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  }, [
    currentAsset?.id,
    currentAsset?.sourcePath,
    currentIndex,
    currentScene?.durationMs,
    scenes.length,
  ]);

  useEffect(() => {
    if (
      currentSceneStartMs === null ||
      !awaitingTimelinePositionRef.current
    ) {
      return;
    }

    awaitingTimelinePositionRef.current = false;
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek?.sceneIndex === currentIndex) {
      setGlobalCurrentTimeMs(pendingSeek.globalTimeMs);
    } else {
      let sceneLocalTimeMs = 0;
      if (currentAsset?.kind === 'video' && videoRef.current) {
        sceneLocalTimeMs = Math.round(videoRef.current.currentTime * 1000);
      } else if (currentAsset?.kind === 'image' && currentScene?.durationMs) {
        const remainingMs =
          imageTimerStartedAtRef.current === null
            ? remainingImageMsRef.current
            : Math.max(
                0,
                imageTimerStartingRemainingMsRef.current -
                  (Date.now() - imageTimerStartedAtRef.current),
              );
        sceneLocalTimeMs = currentScene.durationMs - remainingMs;
      }
      const globalTimeMs = Math.min(
        currentSceneTiming?.endMs ?? currentSceneStartMs,
        currentSceneStartMs + sceneLocalTimeMs,
      );
      setGlobalCurrentTimeMs(globalTimeMs);
      applyNarrationSeek(globalTimeMs);
    }
  }, [currentIndex, currentSceneStartMs]);

  useEffect(() => {
    setNarrationError(null);
    setNarrationEnded(false);
    setNarrationDurationMs(undefined);
    pendingNarrationSeekMsRef.current = narration
      ? (pendingSeekRef.current?.globalTimeMs ??
        Math.max(globalCurrentTimeMs, currentSceneStartMs ?? 0))
      : null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [narration?.sourcePath]);

  useEffect(() => {
    if (
      !isPlaying ||
      mediaError ||
      currentAsset?.kind !== 'image' ||
      !currentScene?.durationMs
    ) {
      return;
    }

    if (imageTimerResetRef.current) {
      remainingImageMsRef.current = currentScene.durationMs;
      imageTimerResetRef.current = false;
    } else if (remainingImageMsRef.current <= 0) {
      remainingImageMsRef.current = currentScene.durationMs;
    }

    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek?.sceneIndex === currentIndex) {
      remainingImageMsRef.current = Math.max(
        0,
        currentScene.durationMs - pendingSeek.sceneLocalTimeMs,
      );
      pendingSeekRef.current = null;
    }

    const startedAt = Date.now();
    const startingRemainingMs = remainingImageMsRef.current;
    imageTimerStartedAtRef.current = startedAt;
    imageTimerStartingRemainingMsRef.current = startingRemainingMs;
    let completed = false;
    const timeoutId = setTimeout(() => {
      completed = true;
      remainingImageMsRef.current = currentScene.durationMs as number;
      if (currentSceneTiming) {
        setGlobalCurrentTimeMs(currentSceneTiming.endMs);
      }
      const nextScene = scenes[currentIndex + 1];
      if (nextScene) {
        automaticSceneChangeRef.current = true;
        onSelectScene(currentIndex + 1);
      } else {
        audioRef.current?.pause();
        setIsPlaying(false);
      }
    }, remainingImageMsRef.current);
    const intervalId = setInterval(() => {
      if (!currentSceneTiming) {
        return;
      }
      const remainingMs = Math.max(
        0,
        startingRemainingMs - (Date.now() - startedAt),
      );
      setGlobalCurrentTimeMs(
        currentSceneTiming.endMs - remainingMs,
      );
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      imageTimerStartedAtRef.current = null;
      if (
        !completed &&
        !pendingSeekRef.current &&
        !imageTimerResetRef.current
      ) {
        remainingImageMsRef.current = Math.max(
          0,
          startingRemainingMs - (Date.now() - startedAt),
        );
      }
    };
  }, [
    currentAsset?.kind,
    currentIndex,
    currentScene?.durationMs,
    currentScene?.mediaId,
    isPlaying,
    mediaError,
    onSelectScene,
    playbackRestartToken,
    seekRevision,
    scenes,
    currentSceneTiming,
  ]);

  useEffect(() => {
    if (
      !isPlaying ||
      currentAsset?.kind !== 'video' ||
      !videoRef.current ||
      (pendingSeekRef.current?.sceneIndex === currentIndex &&
        !activeVideoMetadataReadyRef.current)
    ) {
      return;
    }

    let active = true;
    void videoRef.current.play().catch(() => {
      if (active) {
        audioRef.current?.pause();
        setMediaError('play');
        setIsPlaying(false);
      }
    });

    return () => {
      active = false;
    };
  }, [
    currentAsset?.kind,
    selectedSceneIndex,
    isPlaying,
    playbackRestartToken,
    seekRevision,
  ]);

  useEffect(() => {
    const pendingScene = pendingSeekRef.current
      ? scenes[pendingSeekRef.current.sceneIndex]
      : null;
    const pendingAsset = pendingScene
      ? mediaById.get(pendingScene.mediaId)
      : null;
    if (
      !isPlaying ||
      !narration ||
      narrationError ||
      narrationEnded ||
      !audioRef.current ||
      pendingAsset?.kind === 'video'
    ) {
      return;
    }

    let active = true;
    void audioRef.current.play().catch(() => {
      if (active) {
        setNarrationError('play');
      }
    });

    return () => {
      active = false;
    };
  }, [
    isPlaying,
    narration,
    narrationEnded,
    narrationError,
    playbackRestartToken,
    seekRevision,
    mediaById,
    scenes,
  ]);

  const selectScene = (index: number): void => {
    if (index < 0 || index >= scenes.length) {
      return;
    }

    pendingSeekRef.current = null;
    if (isPlaying && currentAsset?.kind === 'video') {
      videoRef.current?.pause();
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    onSelectScene(index);
  };

  const handleGlobalSeek = (requestedGlobalTimeMs: number): void => {
    if (!previewTimeline) {
      return;
    }

    const position = locatePreviewTime(
      previewTimeline,
      requestedGlobalTimeMs,
    );
    if (!position) {
      return;
    }

    const targetScene = scenes[position.sceneIndex];
    const targetAsset = targetScene
      ? mediaById.get(targetScene.mediaId)
      : null;
    if (!targetScene || !targetAsset) {
      return;
    }
    pendingSeekRef.current = {
      ...position,
      mediaId: targetScene.mediaId,
      sourcePath: targetAsset.sourcePath,
    };
    setGlobalCurrentTimeMs(position.globalTimeMs);
    applyNarrationSeek(position.globalTimeMs);
    if (
      isPlaying &&
      targetAsset?.kind === 'video' &&
      (position.sceneIndex !== currentIndex ||
        !activeVideoMetadataReadyRef.current)
    ) {
      audioRef.current?.pause();
    }

    if (position.atProjectEnd) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      setIsPlaying(false);
    }

    if (position.sceneIndex !== currentIndex) {
      onSelectScene(position.sceneIndex);
      setSeekRevision((revision) => revision + 1);
      return;
    }

    if (currentAsset?.kind === 'image' && currentScene?.durationMs) {
      if (!isPlaying) {
        remainingImageMsRef.current = Math.max(
          0,
          currentScene.durationMs - position.sceneLocalTimeMs,
        );
        imageTimerStartingRemainingMsRef.current =
          remainingImageMsRef.current;
        pendingSeekRef.current = null;
      }
      setSeekRevision((revision) => revision + 1);
      return;
    }

    if (
      currentAsset?.kind === 'video' &&
      videoRef.current &&
      activeVideoMetadataReadyRef.current
    ) {
      applyPendingVideoSeek(videoRef.current);
    }
    setSeekRevision((revision) => revision + 1);
  };

  const togglePlayback = (): void => {
    if (!currentScene || !currentAsset || mediaError) {
      return;
    }

    if (isPlaying) {
      if (currentAsset.kind === 'video') {
        videoRef.current?.pause();
      }
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
  };

  const handleVideoEnded = (): void => {
    if (currentSceneTiming) {
      setGlobalCurrentTimeMs(currentSceneTiming.endMs);
    }
    const nextScene = scenes[currentIndex + 1];
    if (nextScene) {
      automaticSceneChangeRef.current = true;
      onSelectScene(currentIndex + 1);
    } else {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const handleLoadError = (): void => {
    audioRef.current?.pause();
    setMediaError('load');
    setIsPlaying(false);
  };

  const restartPlayback = (): void => {
    const firstScene = scenes[0];
    const firstAsset = media.find(({ id }) => id === firstScene?.mediaId);
    if (!firstScene || !firstAsset) {
      return;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    remainingImageMsRef.current = 0;
    imageTimerResetRef.current = true;
    pendingSeekRef.current = null;
    pendingNarrationSeekMsRef.current = null;
    setGlobalCurrentTimeMs(0);
    setMediaError(null);
    setNarrationError(null);
    setNarrationEnded(false);
    onSelectScene(0);
    setPlaybackRestartToken((token) => token + 1);
    setIsPlaying(true);
  };

  return (
    <section className="panel preview-panel" aria-labelledby="preview-heading">
      <h2 id="preview-heading">미리보기</h2>
      <div className="preview-frame">
        {!currentScene || !currentAsset ? (
          <p className="preview-empty">
            {scenes.length === 0
              ? narration
                ? '내레이션은 선택되어 있습니다. 미리보려면 사진 또는 영상을 추가하세요.'
                : '사진 또는 영상을 추가하면 편집을 시작할 수 있습니다.'
              : '미리볼 장면이 없습니다.'}
          </p>
        ) : mediaError ? (
          <p className="preview-error" role="alert">
            {mediaError === 'play'
              ? '미디어를 재생하지 못했습니다.'
              : '미디어를 불러오지 못했습니다.'}
          </p>
        ) : currentAsset.kind === 'image' ? (
          <img
            alt={currentAsset.fileName}
            className="preview-media"
            onError={handleLoadError}
            src={createMediaUrl(currentAsset.sourcePath)}
          />
        ) : (
          <video
            aria-label={`${currentAsset.fileName} 미리보기`}
            className="preview-media"
            onEnded={handleVideoEnded}
            onError={handleLoadError}
            onLoadedMetadata={(event) => {
              readyVideoElementRef.current = event.currentTarget;
              readyVideoSourcePathRef.current = currentAsset.sourcePath;
              activeVideoMetadataReadyRef.current = true;
              const durationMs = readMediaDurationMs(event.currentTarget);
              storeVideoDuration(currentAsset, durationMs);
              const applied = applyPendingVideoSeek(event.currentTarget);
              if (applied) {
                setSeekRevision((revision) => revision + 1);
              }
            }}
            onTimeUpdate={(event) => {
              if (!currentSceneTiming || pendingSeekRef.current) {
                return;
              }
              setGlobalCurrentTimeMs(
                Math.min(
                  currentSceneTiming.endMs,
                  currentSceneTiming.startMs +
                    Math.round(event.currentTarget.currentTime * 1000),
                ),
              );
            }}
            preload="metadata"
            ref={videoRef}
            src={createMediaUrl(currentAsset.sourcePath)}
          />
        )}
        {currentScene?.subtitle ? (
          <p className="preview-subtitle" style={previewSubtitleStyle}>
            {currentScene.subtitle}
          </p>
        ) : null}
      </div>
      <div className="preview-seek">
        <span className="preview-time">
          {formatPreviewTime(globalCurrentTimeMs)} /{' '}
          {previewTimeline
            ? formatPreviewTime(previewTimeline.totalDurationMs)
            : '--:--'}
        </span>
        <input
          aria-label="전체 프로젝트 재생 위치"
          disabled={!previewTimeline || previewTimeline.scenes.length === 0}
          max={previewTimeline?.totalDurationMs ?? 0}
          min="0"
          step="1"
          type="range"
          value={Math.min(
            globalCurrentTimeMs,
            previewTimeline?.totalDurationMs ?? 0,
          )}
          onChange={(event) =>
            handleGlobalSeek(Number(event.currentTarget.value))
          }
        />
      </div>
      <div className="preview-metadata" aria-hidden="true">
        {videoAssets.map((asset) => (
          <video
            data-preview-metadata-id={asset.id}
            key={`${asset.id}-${asset.sourcePath}`}
            preload="metadata"
            src={createMediaUrl(asset.sourcePath)}
            onError={() => storeVideoDuration(asset, null)}
            onLoadedMetadata={(event) => {
              const durationMs = readMediaDurationMs(event.currentTarget);
              storeVideoDuration(asset, durationMs);
            }}
          />
        ))}
      </div>
      {narration ? (
        <audio
          aria-label="내레이션"
          onEnded={() => setNarrationEnded(true)}
          onError={() => {
            pendingNarrationSeekMsRef.current = null;
            setNarrationDurationMs(null);
            setNarrationError('load');
          }}
          onLoadedMetadata={(event) => {
            const durationMs = readMediaDurationMs(event.currentTarget);
            setNarrationDurationMs(durationMs);
            const pendingTimeMs = pendingNarrationSeekMsRef.current;
            if (durationMs !== null && pendingTimeMs !== null) {
              applyNarrationSeek(pendingTimeMs, durationMs);
            }
          }}
          preload="metadata"
          ref={audioRef}
          src={createMediaUrl(narration.sourcePath)}
        />
      ) : null}
      {narrationError ? (
        <p className="narration-error" role="alert">
          {narrationError === 'play'
            ? '내레이션을 재생하지 못했습니다.'
            : '내레이션을 불러오지 못했습니다.'}
        </p>
      ) : null}
      <div className="preview-controls">
        <button
          type="button"
          disabled={scenes.length === 0}
          onClick={restartPlayback}
        >
          처음부터
        </button>
        <button
          type="button"
          disabled={currentIndex <= 0}
          onClick={() => selectScene(currentIndex - 1)}
        >
          이전
        </button>
        <button
          type="button"
          disabled={!currentScene || !currentAsset || mediaError !== null}
          onClick={togglePlayback}
        >
          {isPlaying ? '일시정지' : '재생'}
        </button>
        <button
          type="button"
          disabled={currentIndex < 0 || currentIndex >= scenes.length - 1}
          onClick={() => selectScene(currentIndex + 1)}
        >
          다음
        </button>
      </div>
    </section>
  );
}
