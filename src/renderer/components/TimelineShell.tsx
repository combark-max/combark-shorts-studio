import type { MediaAsset, Scene } from '../../shared/project/types';

interface TimelineShellProps {
  media: MediaAsset[];
  scenes: Scene[];
  selectedMediaId: string | null;
  onSelectScene: (mediaId: string) => void;
  onMoveScene: (mediaId: string, direction: 'up' | 'down') => void;
  onDeleteScene: (mediaId: string) => void;
  onUpdateSceneDuration: (mediaId: string, durationMs: number) => void;
  onUpdateSceneSubtitle: (mediaId: string, subtitle: string) => void;
}

export function TimelineShell({
  media,
  scenes,
  selectedMediaId,
  onSelectScene,
  onMoveScene,
  onDeleteScene,
  onUpdateSceneDuration,
  onUpdateSceneSubtitle,
}: TimelineShellProps) {
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
                  scene.mediaId === selectedMediaId
                    ? 'scene-item scene-item-selected'
                    : 'scene-item'
                }
                key={scene.mediaId}
              >
                <button
                  aria-label={`${index + 1}번 장면 선택`}
                  aria-pressed={scene.mediaId === selectedMediaId}
                  className="scene-select"
                  type="button"
                  onClick={() => onSelectScene(scene.mediaId)}
                >
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
                            onUpdateSceneDuration(scene.mediaId, durationMs);
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <span>길이 미확인</span>
                  )}
                </div>
                <label className="scene-subtitle">
                  <span>{index + 1}번 장면 자막</span>
                  <input
                    type="text"
                    value={scene.subtitle}
                    onChange={(event) =>
                      onUpdateSceneSubtitle(
                        scene.mediaId,
                        event.currentTarget.value,
                      )
                    }
                  />
                </label>
                <div className="scene-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMoveScene(scene.mediaId, 'up')}
                  >
                    위
                  </button>
                  <button
                    type="button"
                    disabled={index === scenes.length - 1}
                    onClick={() => onMoveScene(scene.mediaId, 'down')}
                  >
                    아래
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteScene(scene.mediaId)}
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
