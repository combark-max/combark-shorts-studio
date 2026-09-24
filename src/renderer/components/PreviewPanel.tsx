import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import type {
  MediaAsset,
  NarrationAsset,
  Scene,
} from '../../shared/project/types';
import { getSubtitleStyle } from '../../shared/project/subtitleStyle';

interface PreviewPanelProps {
  media: MediaAsset[];
  narration: NarrationAsset | null;
  scenes: Scene[];
  selectedSceneIndex: number | null;
  onSelectScene: (sceneIndex: number) => void;
}

type MediaError = 'load' | 'play' | null;
type NarrationError = 'load' | 'play' | null;

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
  const remainingImageMsRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  useEffect(() => {
    setMediaError(null);
    remainingImageMsRef.current = currentScene?.durationMs ?? 0;
    if (currentAsset?.kind === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0;
    }

    if (!currentScene || !currentAsset) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  }, [currentAsset, currentIndex, currentScene?.durationMs]);

  useEffect(() => {
    setNarrationError(null);
    setNarrationEnded(false);
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

    if (remainingImageMsRef.current <= 0) {
      remainingImageMsRef.current = currentScene.durationMs;
    }

    const startedAt = Date.now();
    let completed = false;
    const timeoutId = setTimeout(() => {
      completed = true;
      remainingImageMsRef.current = currentScene.durationMs as number;
      const nextScene = scenes[currentIndex + 1];
      if (nextScene) {
        onSelectScene(currentIndex + 1);
      } else {
        audioRef.current?.pause();
        setIsPlaying(false);
      }
    }, remainingImageMsRef.current);

    return () => {
      clearTimeout(timeoutId);
      if (!completed) {
        remainingImageMsRef.current = Math.max(
          0,
          remainingImageMsRef.current - (Date.now() - startedAt),
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
    scenes,
  ]);

  useEffect(() => {
    if (!isPlaying || currentAsset?.kind !== 'video' || !videoRef.current) {
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
  ]);

  useEffect(() => {
    if (
      !isPlaying ||
      !narration ||
      narrationError ||
      narrationEnded ||
      !audioRef.current
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
  ]);

  const selectScene = (index: number): void => {
    if (index < 0 || index >= scenes.length) {
      return;
    }

    if (isPlaying && currentAsset?.kind === 'video') {
      videoRef.current?.pause();
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    onSelectScene(index);
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
    const nextScene = scenes[currentIndex + 1];
    if (nextScene) {
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
      {narration ? (
        <audio
          aria-label="내레이션"
          onEnded={() => setNarrationEnded(true)}
          onError={() => setNarrationError('load')}
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
