import { useState } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import type {
  MediaAsset,
  NarrationAsset,
  Scene,
  SubtitlePosition,
  SubtitleSize,
} from '../../shared/project/types';
import type { TimelinePlaybackSnapshot } from '../project/timelineLayout';
import { MultiTrackTimeline } from './MultiTrackTimeline';

interface TimelineShellProps {
  media: MediaAsset[];
  narration: NarrationAsset | null;
  scenes: Scene[];
  selectedSceneIndex: number | null;
  playback: TimelinePlaybackSnapshot;
  onSelectScene: (sceneIndex: number) => void;
  onAddMedia: () => void | Promise<void>;
  onMoveScene: (sceneIndex: number, direction: 'up' | 'down') => void;
  onMoveSceneTo: (fromIndex: number, toIndex: number) => void;
  onDeleteScene: (sceneIndex: number) => void;
  onDuplicateScene: (sceneIndex: number) => void;
  onUpdateSceneDuration: (sceneIndex: number, durationMs: number) => void;
  onUpdateVideoPlaybackDuration: (sceneIndex: number, durationMs: number) => void;
  onUpdateSceneSubtitle: (sceneIndex: number, subtitle: string) => void;
  onUpdateSceneSubtitlePosition: (
    sceneIndex: number,
    position: SubtitlePosition,
  ) => void;
  onUpdateSceneSubtitleSize: (
    sceneIndex: number,
    size: SubtitleSize,
  ) => void;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function TimelineShell({
  media,
  narration,
  scenes,
  selectedSceneIndex,
  playback,
  onSelectScene,
  onAddMedia,
  onMoveScene,
  onMoveSceneTo,
  onDeleteScene,
  onDuplicateScene,
  onUpdateSceneDuration,
  onUpdateVideoPlaybackDuration,
  onUpdateSceneSubtitle,
  onUpdateSceneSubtitlePosition,
  onUpdateSceneSubtitleSize,
}: TimelineShellProps) {
  const [detailExpanded, setDetailExpanded] = useState(false);
  const selectedScene =
    selectedSceneIndex !== null ? scenes[selectedSceneIndex] : undefined;
  const selectedAsset = media.find(
    (asset) => asset.id === selectedScene?.mediaId,
  );
  const selectedTiming =
    selectedSceneIndex !== null
      ? playback.sceneTimings.find(
          (timing) => timing.sceneIndex === selectedSceneIndex,
        )
      : undefined;

  return (
    <section
      aria-labelledby="timeline-heading"
      className="timeline-shell"
    >
      <h2 id="timeline-heading">타임라인</h2>
      <MultiTrackTimeline
        media={media}
        narration={narration}
        onAddMedia={onAddMedia}
        onDeleteScene={onDeleteScene}
        onDuplicateScene={onDuplicateScene}
        onMoveScene={onMoveScene}
        onMoveSceneTo={onMoveSceneTo}
        onSelectScene={onSelectScene}
        onUpdateSceneDuration={onUpdateSceneDuration}
        onUpdateVideoPlaybackDuration={onUpdateVideoPlaybackDuration}
        playback={playback}
        scenes={scenes}
        selectedSceneIndex={selectedSceneIndex}
      />

      <div className="selected-scene-detail">
        <div className="selected-scene-detail-header">
          <h3>선택 장면 상세</h3>
          <button
            aria-controls="selected-scene-detail-content"
            aria-expanded={detailExpanded}
            aria-label={
              detailExpanded
                ? '선택 장면 상세 접기'
                : '선택 장면 상세 펼치기'
            }
            type="button"
            onClick={() => setDetailExpanded((expanded) => !expanded)}
          >
            {detailExpanded ? '접기' : '펼치기'}
          </button>
        </div>
        {detailExpanded ? (
          <div id="selected-scene-detail-content">
            {!selectedScene || !selectedAsset || selectedSceneIndex === null ? (
              <p className="scene-empty">선택된 장면이 없습니다.</p>
            ) : (
              <div className="selected-scene-editor">
            <div className="selected-scene-summary">
              <span className="selected-scene-thumbnail" aria-hidden="true">
                {selectedAsset.kind === 'image' ? (
                  <img alt="" src={createMediaUrl(selectedAsset.sourcePath)} />
                ) : (
                  <span>영상</span>
                )}
              </span>
              <div>
                <strong>
                  {selectedSceneIndex + 1}번 장면 · {selectedAsset.fileName}
                </strong>
                <span>
                  {selectedAsset.kind === 'image' ? '이미지' : '영상'}
                </span>
                {selectedAsset.kind === 'video' && selectedTiming ? (
                  <span>
                    장면 길이 {formatDuration(selectedTiming.durationMs)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="selected-scene-fields">
              {selectedAsset.kind === 'image' ? (
                <label>
                  이미지 표시시간 (초)
                  <input
                    aria-label="이미지 표시시간 (초)"
                    min="0.001"
                    step="0.001"
                    type="number"
                    value={(selectedScene.durationMs ?? 3000) / 1000}
                    onChange={(event) => {
                      const durationMs = Math.round(
                        Number(event.currentTarget.value) * 1000,
                      );
                      if (durationMs > 0) {
                        onUpdateSceneDuration(
                          selectedSceneIndex,
                          durationMs,
                        );
                      }
                    }}
                  />
                </label>
              ) : null}
              <label className="selected-scene-subtitle">
                자막 내용
                <input
                  aria-label="선택 장면 자막"
                  type="text"
                  value={selectedScene.subtitle}
                  onChange={(event) =>
                    onUpdateSceneSubtitle(
                      selectedSceneIndex,
                      event.currentTarget.value,
                    )
                  }
                />
              </label>
              <label>
                자막 위치
                <select
                  aria-label="선택 장면 자막 위치"
                  value={selectedScene.subtitlePosition}
                  onChange={(event) =>
                    onUpdateSceneSubtitlePosition(
                      selectedSceneIndex,
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
                자막 크기
                <select
                  aria-label="선택 장면 자막 크기"
                  value={selectedScene.subtitleSize}
                  onChange={(event) =>
                    onUpdateSceneSubtitleSize(
                      selectedSceneIndex,
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
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
