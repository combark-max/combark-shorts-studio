import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

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
import {
  buildDraftTimelineBlocks,
  getSceneInsertionIndex,
  getSceneMoveTargetIndex,
  getSnappedImageDurationMs,
} from '../project/timelineInteraction';

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
  onMoveSceneTo: (fromIndex: number, toIndex: number) => void;
  onUpdateSceneDuration: (sceneIndex: number, durationMs: number) => void;
}

type TimelineInteraction =
  | {
      kind: 'reorder';
      pointerId: number;
      sceneIndex: number;
      startClientX: number;
      insertionIndex: number;
      started: boolean;
    }
  | {
      kind: 'resize';
      pointerId: number;
      sceneIndex: number;
      startClientX: number;
      originalDurationMs: number;
      draftDurationMs: number;
    };

const REORDER_DRAG_THRESHOLD_PX = 5;

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
  onMoveSceneTo,
  onUpdateSceneDuration,
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
  const [interaction, setInteraction] = useState<TimelineInteraction | null>(null);
  const interactionRef = useRef<TimelineInteraction | null>(null);
  const suppressClickRef = useRef(false);
  const autoFollowResumeTimeRef = useRef<number | null>(null);
  const resizeInteraction = interaction?.kind === 'resize' ? interaction : null;
  const displayBlocks = resizeInteraction
    ? buildDraftTimelineBlocks(
        layout.blocks,
        resizeInteraction.sceneIndex,
        resizeInteraction.draftDurationMs,
      )
    : layout.blocks;
  const blockBySceneIndex = new Map(
    displayBlocks.map((block) => [block.sceneIndex, block]),
  );
  const lastDisplayBlock = displayBlocks.at(-1);
  const draftCanvasWidthPx = lastDisplayBlock
    ? lastDisplayBlock.leftPx + lastDisplayBlock.widthPx
    : 0;
  const canvasWidthPx = Math.max(draftCanvasWidthPx, 720);
  const playheadLeftPx = getPlayheadLeftPx(
    playback.currentTimeMs,
    playback.totalDurationMs,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const narrationWidthPx =
    narration && typeof playback.narrationDurationMs === 'number'
      ? (Math.min(
          playback.narrationDurationMs,
          playback.totalDurationMs,
        ) /
          1000) *
        TIMELINE_PIXELS_PER_SECOND
      : null;

  const updateInteraction = (nextInteraction: TimelineInteraction | null) => {
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  };

  const finishInteraction = () => {
    if (interactionRef.current) {
      autoFollowResumeTimeRef.current = playback.currentTimeMs;
    }
    interactionRef.current = null;
    setInteraction(null);
  };

  const suppressNextClipClick = () => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const handleReorderPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sceneIndex: number,
  ) => {
    if (event.button !== 0 || interactionRef.current) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateInteraction({
      kind: 'reorder',
      pointerId: event.pointerId,
      sceneIndex,
      startClientX: event.clientX,
      insertionIndex: sceneIndex,
      started: false,
    });
  };

  const handleReorderPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = interactionRef.current;
    if (current?.kind !== 'reorder' || current.pointerId !== event.pointerId) {
      return;
    }
    const started =
      current.started ||
      Math.abs(event.clientX - current.startClientX) >= REORDER_DRAG_THRESHOLD_PX;
    if (!started) {
      return;
    }
    if (!current.started) {
      onSelectScene(current.sceneIndex);
    }
    const scroll = scrollRef.current;
    const canvasX = scroll
      ? event.clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft
      : event.clientX;
    updateInteraction({
      ...current,
      started: true,
      insertionIndex: getSceneInsertionIndex(canvasX, layout.blocks),
    });
  };

  const handleReorderPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = interactionRef.current;
    if (current?.kind !== 'reorder' || current.pointerId !== event.pointerId) {
      return;
    }
    if (current.started) {
      const targetIndex = getSceneMoveTargetIndex(
        current.sceneIndex,
        current.insertionIndex,
        scenes.length,
      );
      if (targetIndex !== current.sceneIndex) {
        onMoveSceneTo(current.sceneIndex, targetIndex);
      }
      suppressNextClipClick();
    }
    finishInteraction();
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    sceneIndex: number,
    durationMs: number,
  ) => {
    if (event.button !== 0 || interactionRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectScene(sceneIndex);
    updateInteraction({
      kind: 'resize',
      pointerId: event.pointerId,
      sceneIndex,
      startClientX: event.clientX,
      originalDurationMs: durationMs,
      draftDurationMs: durationMs,
    });
  };

  const handleResizePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = interactionRef.current;
    if (current?.kind !== 'resize' || current.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateInteraction({
      ...current,
      draftDurationMs: getSnappedImageDurationMs(
        current.originalDurationMs,
        event.clientX - current.startClientX,
      ),
    });
  };

  const handleResizePointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const current = interactionRef.current;
    if (current?.kind !== 'resize' || current.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (current.draftDurationMs !== current.originalDurationMs) {
      onUpdateSceneDuration(current.sceneIndex, current.draftDurationMs);
    }
    finishInteraction();
  };

  const cancelPointerInteraction = () => {
    if (interactionRef.current?.kind === 'reorder' && interactionRef.current.started) {
      suppressNextClipClick();
    }
    finishInteraction();
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && interactionRef.current) {
        if (interactionRef.current.kind === 'reorder') {
          suppressNextClipClick();
        }
        finishInteraction();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (
      !scroll ||
      !playback.ready ||
      scroll.clientWidth <= 0 ||
      interaction !== null
    ) {
      return;
    }

    if (autoFollowResumeTimeRef.current === playback.currentTimeMs) {
      return;
    }
    autoFollowResumeTimeRef.current = null;

    const viewportLeft = scroll.scrollLeft;
    const viewportWidth = scroll.clientWidth;
    const safeLeft = viewportLeft + viewportWidth * 0.2;
    const safeRight = viewportLeft + viewportWidth * 0.8;
    let nextScrollLeft = viewportLeft;

    if (playheadLeftPx < safeLeft) {
      nextScrollLeft = playheadLeftPx - viewportWidth * 0.25;
    } else if (playheadLeftPx > safeRight) {
      nextScrollLeft = playheadLeftPx - viewportWidth * 0.72;
    }

    const maxScrollLeft = Math.max(0, scroll.scrollWidth - viewportWidth);
    nextScrollLeft = Math.min(Math.max(nextScrollLeft, 0), maxScrollLeft);
    if (nextScrollLeft !== viewportLeft) {
      scroll.scrollLeft = nextScrollLeft;
    }
  }, [interaction, playback.currentTimeMs, playback.ready, playheadLeftPx]);

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
          <div className="timeline-scroll" ref={scrollRef}>
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
                    <div
                      className={`${
                        sceneIndex === selectedSceneIndex
                          ? 'timeline-clip timeline-clip-selected'
                          : 'timeline-clip'
                      }${
                        interaction?.kind === 'reorder' &&
                        interaction.sceneIndex === sceneIndex &&
                        interaction.started
                          ? ' timeline-clip-dragging'
                          : ''
                      }`}
                      key={`${scene.mediaId}-${sceneIndex}`}
                      style={{
                        left: `${block.leftPx}px`,
                        width: `${block.widthPx}px`,
                      }}
                    >
                      <button
                        aria-label={`${sceneIndex + 1}번 장면 ${asset.fileName}`}
                        aria-pressed={sceneIndex === selectedSceneIndex}
                        className="timeline-clip-select"
                        type="button"
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          onSelectScene(sceneIndex);
                        }}
                        onLostPointerCapture={cancelPointerInteraction}
                        onPointerCancel={cancelPointerInteraction}
                        onPointerDown={(event) =>
                          handleReorderPointerDown(event, sceneIndex)
                        }
                        onPointerMove={handleReorderPointerMove}
                        onPointerUp={handleReorderPointerUp}
                      >
                        {asset.kind === 'image' ? (
                          <img alt="" src={createMediaUrl(asset.sourcePath)} />
                        ) : (
                          <span className="timeline-video-badge">영상</span>
                        )}
                        <span className="timeline-clip-name">
                          {asset.fileName}
                        </span>
                      </button>
                      {asset.kind === 'image' && scene.durationMs !== null ? (
                        <button
                          aria-label={`${sceneIndex + 1}번 장면 길이 조절`}
                          className="timeline-resize-handle"
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          onLostPointerCapture={cancelPointerInteraction}
                          onPointerCancel={cancelPointerInteraction}
                          onPointerDown={(event) =>
                            handleResizePointerDown(
                              event,
                              sceneIndex,
                              scene.durationMs as number,
                            )
                          }
                          onPointerMove={handleResizePointerMove}
                          onPointerUp={handleResizePointerUp}
                        />
                      ) : null}
                      {resizeInteraction?.sceneIndex === sceneIndex ? (
                        <span className="timeline-resize-duration">
                          {(resizeInteraction.draftDurationMs / 1000).toFixed(1)}초
                        </span>
                      ) : null}
                    </div>
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
                  left: `${playheadLeftPx}px`,
                }}
              />
              {interaction?.kind === 'reorder' && interaction.started ? (
                <div
                  aria-hidden="true"
                  className="timeline-drop-indicator"
                  style={{
                    left: `${
                      interaction.insertionIndex >= layout.blocks.length
                        ? (() => {
                            const lastBlock = layout.blocks.at(-1);
                            return lastBlock
                              ? lastBlock.leftPx + lastBlock.widthPx
                              : 0;
                          })()
                        : (layout.blocks[interaction.insertionIndex]?.leftPx ?? 0)
                    }px`,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
