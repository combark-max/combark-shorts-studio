import { useState } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import type {
  MediaAsset,
  Scene,
  SubtitlePosition,
  SubtitleSize,
} from '../../shared/project/types';

interface TimelineShellProps {
  media: MediaAsset[];
  scenes: Scene[];
  selectedSceneIndex: number | null;
  onSelectScene: (sceneIndex: number) => void;
  onMoveScene: (sceneIndex: number, direction: 'up' | 'down') => void;
  onDeleteScene: (sceneIndex: number) => void;
  onDuplicateScene: (sceneIndex: number) => void;
  onUpdateSceneDuration: (sceneIndex: number, durationMs: number) => void;
  onUpdateSceneSubtitle: (sceneIndex: number, subtitle: string) => void;
  onUpdateSceneSubtitlePosition: (sceneIndex: number, position: SubtitlePosition) => void;
  onUpdateSceneSubtitleSize: (sceneIndex: number, size: SubtitleSize) => void;
}

type VideoDurations = Record<string, number | null>;

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function TimelineShell({
  media,
  scenes,
  selectedSceneIndex,
  onSelectScene,
  onMoveScene,
  onDeleteScene,
  onDuplicateScene,
  onUpdateSceneDuration,
  onUpdateSceneSubtitle,
  onUpdateSceneSubtitlePosition,
  onUpdateSceneSubtitleSize,
}: TimelineShellProps) {
  const [videoDurations, setVideoDurations] = useState<VideoDurations>({});

  const updateVideoDuration = (mediaId: string, duration: number): void => {
    const durationSeconds =
      Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : null;
    setVideoDurations((currentDurations) => ({
      ...currentDurations,
      [mediaId]: durationSeconds,
    }));
  };

  const markVideoDurationUnavailable = (mediaId: string): void => {
    setVideoDurations((currentDurations) =>
      Object.prototype.hasOwnProperty.call(currentDurations, mediaId)
        ? currentDurations
        : { ...currentDurations, [mediaId]: null },
    );
  };

  return (
    <section className="timeline-shell" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">장면 목록</h2>
      {scenes.length === 0 ? (
        <p className="scene-empty">장면이 없습니다.</p>
      ) : (
        <ol className="scene-list">
          {scenes.map((scene, index) => {
            const asset = media.find(({ id }) => id === scene.mediaId);

            if (!asset) {
              return null;
            }

            return (
              <li
                className={
                  index === selectedSceneIndex
                    ? 'scene-item scene-item-selected'
                    : 'scene-item'
                }
                key={`${scene.mediaId}-${index}`}
              >
                <button
                  aria-label={`${index + 1}번 장면 선택`}
                  aria-pressed={index === selectedSceneIndex}
                  className="scene-select"
                  type="button"
                  onClick={() => onSelectScene(index)}
                >
                  <span className="scene-thumbnail" aria-hidden="true">
                    {asset.kind === 'image' ? (
                      <img
                        alt=""
                        src={createMediaUrl(asset.sourcePath)}
                      />
                    ) : (
                      <video
                        muted
                        playsInline
                        preload="metadata"
                        src={createMediaUrl(asset.sourcePath)}
                        onError={() => markVideoDurationUnavailable(asset.id)}
                        onLoadedMetadata={(event) => {
                          const { duration } = event.currentTarget;
                          updateVideoDuration(asset.id, duration);

                          if (Number.isFinite(duration) && duration > 0) {
                            try {
                              event.currentTarget.currentTime = Math.min(
                                0.01,
                                duration / 2,
                              );
                            } catch {
                              // Duration remains usable when thumbnail seeking fails.
                            }
                          }
                        }}
                      />
                    )}
                  </span>
                  <span className="scene-number">{index + 1}</span>
                  <span className="scene-name">{asset.fileName}</span>
                  <span className="scene-kind">
                    {asset.kind === 'image' ? '이미지' : '영상'}
                  </span>
                </button>
                <div className="scene-duration">
                  {asset.kind === 'image' ? (
                    <label>
                      표시시간 (초)
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={(scene.durationMs ?? 3000) / 1000}
                        onChange={(event) => {
                          const durationMs = Math.round(
                            Number(event.currentTarget.value) * 1000,
                          );
                          if (durationMs > 0) {
                            onUpdateSceneDuration(index, durationMs);
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <span>
                      {!Object.prototype.hasOwnProperty.call(
                        videoDurations,
                        asset.id,
                      )
                        ? '길이 확인 중...'
                        : videoDurations[asset.id] === null
                          ? '길이 확인 불가'
                          : formatDuration(videoDurations[asset.id])}
                    </span>
                  )}
                </div>
                <div className="scene-subtitle">
                  <label className="scene-subtitle-text">
                    <span>{index + 1}번 장면 자막</span>
                    <input
                      type="text"
                      value={scene.subtitle}
                      onChange={(event) =>
                        onUpdateSceneSubtitle(
                          index,
                          event.currentTarget.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>위치</span>
                    <select
                      aria-label={`${index + 1}번 장면 자막 위치`}
                      value={scene.subtitlePosition}
                      onChange={(event) =>
                        onUpdateSceneSubtitlePosition(
                          index,
                          event.currentTarget.value as SubtitlePosition,
                        )
                      }
                    >
                      <option value="top">상단</option>
                      <option value="center">중앙</option>
                      <option value="bottom">하단</option>
                    </select>
                  </label>
                  <label>
                    <span>크기</span>
                    <select
                      aria-label={`${index + 1}번 장면 자막 크기`}
                      value={scene.subtitleSize}
                      onChange={(event) =>
                        onUpdateSceneSubtitleSize(
                          index,
                          event.currentTarget.value as SubtitleSize,
                        )
                      }
                    >
                      <option value="small">작게</option>
                      <option value="medium">보통</option>
                      <option value="large">크게</option>
                    </select>
                  </label>
                </div>
                <div className="scene-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMoveScene(index, 'up')}
                  >
                    위
                  </button>
                  <button
                    type="button"
                    disabled={index === scenes.length - 1}
                    onClick={() => onMoveScene(index, 'down')}
                  >
                    아래
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateScene(index)}
                  >
                    복제
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteScene(index)}
                  >
                    파일 제거
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
