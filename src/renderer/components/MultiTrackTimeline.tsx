import { createMediaUrl } from '../../shared/mediaProtocol';
import type {
  MediaAsset,
  NarrationAsset,
  Scene,
} from '../../shared/project/types';
import {
  buildTimelineLayout,
  getPlayheadLeftPx,
  TIMELINE_PIXELS_PER_SECOND,
  type TimelinePlaybackSnapshot,
} from '../project/timelineLayout';

interface MultiTrackTimelineProps {
  media: MediaAsset[];
  scenes: Scene[];
  narration: NarrationAsset | null;
  selectedSceneIndex: number | null;
  playback: TimelinePlaybackSnapshot;
  onSelectScene: (sceneIndex: number) => void;
  onAddMedia: () => void | Promise<void>;
  onDeleteScene: (sceneIndex: number) => void;
  onDuplicateScene: (sceneIndex: number) => void;
  onMoveScene: (sceneIndex: number, direction: 'up' | 'down') => void;
}

function formatTimelineTime(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function MultiTrackTimeline({
  media,
  scenes,
  narration,
  selectedSceneIndex,
  playback,
  onSelectScene,
  onAddMedia,
  onDeleteScene,
  onDuplicateScene,
  onMoveScene,
}: MultiTrackTimelineProps) {
  const hasSelection =
    selectedSceneIndex !== null &&
    selectedSceneIndex >= 0 &&
    selectedSceneIndex < scenes.length;
  const layout = buildTimelineLayout(
    playback.sceneTimings,
    playback.totalDurationMs,
  );
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const blockBySceneIndex = new Map(
    layout.blocks.map((block) => [block.sceneIndex, block]),
  );
  const canvasWidthPx = Math.max(layout.canvasWidthPx, 720);
  const narrationWidthPx =
    narration && typeof playback.narrationDurationMs === 'number'
      ? (Math.min(
          playback.narrationDurationMs,
          playback.totalDurationMs,
        ) /
          1000) *
        TIMELINE_PIXELS_PER_SECOND
      : null;

  return (
    <div className="multi-track-timeline">
      <div className="timeline-toolbar" aria-label="타임라인 장면 작업">
        <button
          type="button"
          onClick={() => {
            void onAddMedia();
          }}
        >
          미디어 추가
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => {
            if (selectedSceneIndex !== null) {
              onDuplicateScene(selectedSceneIndex);
            }
          }}
        >
          선택 장면 복제
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => {
            if (selectedSceneIndex !== null) {
              onDeleteScene(selectedSceneIndex);
            }
          }}
        >
          선택 장면 삭제
        </button>
        <button
          type="button"
          aria-label="선택 장면 이전으로 이동"
          disabled={!hasSelection || selectedSceneIndex === 0}
          onClick={() => {
            if (selectedSceneIndex !== null) {
              onMoveScene(selectedSceneIndex, 'up');
            }
          }}
        >
          이전
        </button>
        <button
          type="button"
          aria-label="선택 장면 다음으로 이동"
          disabled={
            !hasSelection || selectedSceneIndex === scenes.length - 1
          }
          onClick={() => {
            if (selectedSceneIndex !== null) {
              onMoveScene(selectedSceneIndex, 'down');
            }
          }}
        >
          다음
        </button>
      </div>

      {!playback.ready && playback.durationUnavailable ? (
        <div className="timeline-unavailable">
          <p className="timeline-loading" role="status">
            타임라인 길이를 확인할 수 없습니다. 장면을 선택해 미디어를 확인하세요.
          </p>
          <div className="timeline-fallback-scenes" aria-label="장면 선택">
            {scenes.map((scene, sceneIndex) => {
              const asset = mediaById.get(scene.mediaId);
              return asset ? (
                <button
                  aria-label={`${sceneIndex + 1}번 장면 ${asset.fileName}`}
                  aria-pressed={sceneIndex === selectedSceneIndex}
                  className={
                    sceneIndex === selectedSceneIndex
                      ? 'timeline-fallback-scene timeline-clip-selected'
                      : 'timeline-fallback-scene'
                  }
                  key={`${scene.mediaId}-${sceneIndex}`}
                  type="button"
                  onClick={() => onSelectScene(sceneIndex)}
                >
                  {sceneIndex + 1}. {asset.fileName}
                </button>
              ) : null;
            })}
          </div>
        </div>
      ) : !playback.ready ? (
        <p className="timeline-loading" role="status">
          타임라인 준비 중...
        </p>
      ) : scenes.length === 0 ? (
        <p className="scene-empty">장면이 없습니다.</p>
      ) : (
        <div className="timeline-grid">
          <div className="timeline-track-labels" aria-hidden="true">
            <span className="timeline-ruler-label">시간</span>
            <span>사진/영상</span>
            <span>자막</span>
            <span>나레이션</span>
            <span>효과음</span>
            <span>음악</span>
          </div>
          <div className="timeline-scroll">
            <div
              className="timeline-canvas"
              style={{ width: `${canvasWidthPx}px` }}
            >
              <div className="timeline-ruler" aria-label="시간 눈금">
                {layout.ticks.map((tick) => (
                  <span
                    className="timeline-tick"
                    key={tick.timeMs}
                    style={{ left: `${tick.leftPx}px` }}
                  >
                    {formatTimelineTime(tick.timeMs)}
                  </span>
                ))}
              </div>
              <div className="timeline-track" aria-label="사진/영상 트랙">
                {scenes.map((scene, sceneIndex) => {
                  const asset = mediaById.get(scene.mediaId);
                  const block = blockBySceneIndex.get(sceneIndex);
                  if (!asset || !block) {
                    return null;
                  }
                  return (
                    <button
                      aria-label={`${sceneIndex + 1}번 장면 ${asset.fileName}`}
                      aria-pressed={sceneIndex === selectedSceneIndex}
                      className={
                        sceneIndex === selectedSceneIndex
                          ? 'timeline-clip timeline-clip-selected'
                          : 'timeline-clip'
                      }
                      key={`${scene.mediaId}-${sceneIndex}`}
                      style={{
                        left: `${block.leftPx}px`,
                        width: `${block.widthPx}px`,
                      }}
                      type="button"
                      onClick={() => onSelectScene(sceneIndex)}
                    >
                      {asset.kind === 'image' ? (
                        <img alt="" src={createMediaUrl(asset.sourcePath)} />
                      ) : (
                        <span className="timeline-video-badge">영상</span>
                      )}
                      <span>{asset.fileName}</span>
                    </button>
                  );
                })}
              </div>
              <div className="timeline-track" aria-label="자막 트랙">
                {scenes.map((scene, sceneIndex) => {
                  const block = blockBySceneIndex.get(sceneIndex);
                  if (!scene.subtitle || !block) {
                    return null;
                  }
                  return (
                    <button
                      aria-label={`${sceneIndex + 1}번 장면 자막`}
                      className={
                        sceneIndex === selectedSceneIndex
                          ? 'timeline-clip timeline-subtitle-clip timeline-clip-selected'
                          : 'timeline-clip timeline-subtitle-clip'
                      }
                      key={`subtitle-${sceneIndex}`}
                      style={{
                        left: `${block.leftPx}px`,
                        width: `${block.widthPx}px`,
                      }}
                      type="button"
                      onClick={() => onSelectScene(sceneIndex)}
                    >
                      {scene.subtitle}
                    </button>
                  );
                })}
              </div>
              <div className="timeline-track" aria-label="나레이션 트랙">
                {narration ? (
                  playback.narrationDurationMs === undefined ? (
                    <span className="timeline-track-status">
                      나레이션 길이 확인 중...
                    </span>
                  ) : playback.narrationDurationMs === null ? (
                    <span className="timeline-track-status">
                      나레이션 길이 확인 불가
                    </span>
                  ) : (
                    <span
                      className="timeline-audio-clip"
                      style={{
                        left: '0px',
                        width: `${narrationWidthPx ?? 0}px`,
                      }}
                    >
                      {narration.fileName}
                    </span>
                  )
                ) : (
                  <span className="timeline-track-status">나레이션 없음</span>
                )}
              </div>
              <div
                aria-disabled="true"
                aria-label="효과음 트랙"
                className="timeline-track timeline-track-disabled"
              >
                <span>향후 지원</span>
              </div>
              <div
                aria-disabled="true"
                aria-label="음악 트랙"
                className="timeline-track timeline-track-disabled"
              >
                <span>향후 지원</span>
              </div>
              <div
                aria-label="재생 위치선"
                className="timeline-playhead"
                style={{
                  left: `${getPlayheadLeftPx(
                    playback.currentTimeMs,
                    playback.totalDurationMs,
                  )}px`,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
