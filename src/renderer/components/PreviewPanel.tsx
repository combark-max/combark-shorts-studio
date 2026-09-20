import { useEffect, useRef, useState } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import type { MediaAsset, Scene } from '../../shared/project/types';

interface PreviewPanelProps {
  media: MediaAsset[];
  scenes: Scene[];
  selectedMediaId: string | null;
  onSelectScene: (mediaId: string) => void;
}

type MediaError = 'load' | 'play' | null;

export function PreviewPanel({
  media,
  scenes,
  selectedMediaId,
  onSelectScene,
}: PreviewPanelProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [mediaError, setMediaError] = useState<MediaError>(null);
  const remainingImageMsRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const currentIndex = scenes.findIndex(
    (scene) => scene.mediaId === selectedMediaId,
  );
  const currentScene = currentIndex >= 0 ? scenes[currentIndex] : null;
  const currentAsset = media.find(({ id }) => id === selectedMediaId) ?? null;

  useEffect(() => {
    setMediaError(null);
    remainingImageMsRef.current = currentScene?.durationMs ?? 0;

    if (!currentScene || !currentAsset) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
  }, [currentAsset, currentScene?.durationMs, currentScene?.mediaId]);

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
        onSelectScene(nextScene.mediaId);
      } else {
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
    scenes,
  ]);

  useEffect(() => {
    if (!isPlaying || currentAsset?.kind !== 'video' || !videoRef.current) {
      return;
    }

    let active = true;
    void videoRef.current.play().catch(() => {
      if (active) {
        setMediaError('play');
        setIsPlaying(false);
      }
    });

    return () => {
      active = false;
    };
  }, [currentAsset?.kind, selectedMediaId, isPlaying]);

  const selectScene = (index: number): void => {
    if (index < 0 || index >= scenes.length) {
      return;
    }

    if (isPlaying && currentAsset?.kind === 'video') {
      videoRef.current?.pause();
    }
    setIsPlaying(false);
    onSelectScene(scenes[index].mediaId);
  };

  const togglePlayback = (): void => {
    if (!currentScene || !currentAsset || mediaError) {
      return;
    }

    if (isPlaying) {
      if (currentAsset.kind === 'video') {
        videoRef.current?.pause();
      }
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
  };

  const handleVideoEnded = (): void => {
    const nextScene = scenes[currentIndex + 1];
    if (nextScene) {
      onSelectScene(nextScene.mediaId);
    } else {
      setIsPlaying(false);
    }
  };

  const handleLoadError = (): void => {
    setMediaError('load');
    setIsPlaying(false);
  };

  return (
    <section className="panel preview-panel" aria-labelledby="preview-heading">
      <h2 id="preview-heading">미리보기</h2>
      <div className="preview-frame">
        {!currentScene || !currentAsset ? (
          <p className="preview-empty">미리볼 장면이 없습니다.</p>
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
          <p className="preview-subtitle">{currentScene.subtitle}</p>
        ) : null}
      </div>
      <div className="preview-controls">
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
