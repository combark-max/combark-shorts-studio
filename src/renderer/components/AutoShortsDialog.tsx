import { useEffect, useMemo, useState } from 'react';

import { createMediaUrl } from '../../shared/mediaProtocol';
import {
  buildAutoShortsPlan,
  type AutoShortsDurationMode,
} from '../../shared/project/autoShorts';
import type {
  MediaAsset,
  ProjectDocument,
  Scene,
} from '../../shared/project/types';

interface AutoShortsDialogProps {
  project: ProjectDocument;
  missingMediaIds: readonly string[];
  narrationMissing: boolean;
  onCancel(): void;
  onApply(projectSnapshot: ProjectDocument, scenes: Scene[]): boolean;
}

type RuntimeDuration = number | null | undefined;

function readDurationMs(element: HTMLMediaElement): number | null {
  return Number.isFinite(element.duration) && element.duration > 0
    ? Math.round(element.duration * 1000)
    : null;
}

function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(3)}초`;
}

function describeResult(mode: AutoShortsDurationMode): string {
  if (mode === 'narration') {
    return '내레이션 길이에 맞춤';
  }
  if (mode === 'fallback') {
    return '내레이션 길이와 정확히 맞출 수 없어 이미지 장면 3초 적용';
  }
  return '이미지 장면 3초 적용';
}

export function AutoShortsDialog({
  project,
  missingMediaIds,
  narrationMissing,
  onCancel,
  onApply,
}: AutoShortsDialogProps) {
  const missingMediaIdSet = useMemo(
    () => new Set(missingMediaIds),
    [missingMediaIds],
  );
  const mediaById = useMemo(
    () => new Map(project.media.map((asset) => [asset.id, asset])),
    [project.media],
  );
  const videoAssets = useMemo(() => {
    const assets = new Map<string, MediaAsset>();
    for (const scene of project.scenes) {
      const asset = mediaById.get(scene.mediaId);
      if (asset?.kind === 'video') {
        assets.set(asset.id, asset);
      }
    }
    return [...assets.values()];
  }, [mediaById, project.scenes]);
  const [text, setText] = useState('');
  const [narrationDurationMs, setNarrationDurationMs] =
    useState<RuntimeDuration>(() =>
      project.narration ? (narrationMissing ? null : undefined) : null,
    );
  const [videoDurationMsByMediaId, setVideoDurationMsByMediaId] = useState<
    Record<string, RuntimeDuration>
  >(() =>
    Object.fromEntries(
      videoAssets
        .filter((asset) => missingMediaIdSet.has(asset.id))
        .map((asset): [string, null] => [asset.id, null]),
    ),
  );
  const [applyError, setApplyError] = useState(false);

  useEffect(() => {
    if (project.narration && narrationMissing) {
      setNarrationDurationMs(null);
    }
    const missingVideoIds = videoAssets
      .filter((asset) => missingMediaIdSet.has(asset.id))
      .map((asset) => asset.id);
    if (missingVideoIds.length > 0) {
      setVideoDurationMsByMediaId((durations) => {
        if (
          missingVideoIds.every((mediaId) => durations[mediaId] === null)
        ) {
          return durations;
        }
        return {
          ...durations,
          ...Object.fromEntries(
            missingVideoIds.map((mediaId): [string, null] => [mediaId, null]),
          ),
        };
      });
    }
  }, [missingMediaIdSet, narrationMissing, project.narration, videoAssets]);

  const plan = useMemo(
    () =>
      buildAutoShortsPlan(project, text, {
        narrationDurationMs:
          typeof narrationDurationMs === 'number'
            ? narrationDurationMs
            : null,
        videoDurationMsByMediaId,
      }),
    [narrationDurationMs, project, text, videoDurationMsByMediaId],
  );

  const narrationStatus = !project.narration
    ? '없음'
    : narrationDurationMs === undefined
      ? '확인 중...'
      : narrationDurationMs === null
        ? '확인 실패'
        : formatDurationMs(narrationDurationMs);
  const videoStatus =
    videoAssets.length === 0
      ? '영상 없음'
      : videoAssets.some(
            (asset) => videoDurationMsByMediaId[asset.id] === null,
          )
        ? '확인 실패'
        : videoAssets.every(
              (asset) =>
                typeof videoDurationMsByMediaId[asset.id] === 'number',
            )
          ? '모두 확인됨'
          : '확인 중...';
  const metadataFailed =
    (Boolean(project.narration) && narrationDurationMs === null) ||
    videoAssets.some(
      (asset) => videoDurationMsByMediaId[asset.id] === null,
    );
  const metadataLoading =
    Boolean(project.narration) &&
    !metadataFailed &&
    (narrationDurationMs === undefined ||
      videoAssets.some(
        (asset) => videoDurationMsByMediaId[asset.id] === undefined,
      ));
  const hasExistingEdits = project.scenes.some((scene) => {
    const asset = mediaById.get(scene.mediaId);
    return (
      scene.subtitle.length > 0 ||
      (asset?.kind === 'image' && scene.durationMs !== 3000)
    );
  });

  return (
    <div className="auto-shorts-backdrop">
      <section
        aria-labelledby="auto-shorts-heading"
        aria-modal="true"
        className="auto-shorts-dialog"
        role="dialog"
      >
        <h2 id="auto-shorts-heading">쇼츠 자동 만들기</h2>
        <label className="auto-shorts-script">
          <span>대본 또는 자막</span>
          <textarea
            aria-label="대본 또는 자막"
            rows={8}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
        </label>
        <div className="auto-shorts-summary" aria-live="polite">
          <p>현재 장면 수: {project.scenes.length}</p>
          <p>인식된 자막 단위 수: {plan.subtitleUnitCount}</p>
          <p>내레이션 길이: {narrationStatus}</p>
          <p>영상 길이: {videoStatus}</p>
          <p>
            예상 적용 결과:{' '}
            {metadataLoading
              ? '메타데이터 확인 중...'
              : describeResult(plan.durationMode)}
          </p>
          <p>자막 {plan.changedSubtitleCount}개 변경 예정</p>
          <p>
            이미지 표시시간 {plan.changedImageDurationCount}개 변경 예정
          </p>
        </div>
        {hasExistingEdits ? (
          <p className="auto-shorts-warning" role="status">
            기존 수동 편집이 덮어써질 수 있습니다.
          </p>
        ) : null}
        {applyError ? (
          <p className="auto-shorts-error" role="alert">
            프로젝트가 변경되어 자동 구성을 적용하지 못했습니다.
          </p>
        ) : null}
        <div className="auto-shorts-metadata" aria-hidden="true">
          {project.narration && !narrationMissing ? (
            <audio
              preload="metadata"
              src={createMediaUrl(project.narration.sourcePath)}
              onError={() => setNarrationDurationMs(null)}
              onLoadedMetadata={(event) =>
                setNarrationDurationMs(readDurationMs(event.currentTarget))
              }
            />
          ) : null}
          {videoAssets
            .filter((asset) => !missingMediaIdSet.has(asset.id))
            .map((asset) => (
              <video
                key={asset.id}
                preload="metadata"
                src={createMediaUrl(asset.sourcePath)}
                onError={() =>
                  setVideoDurationMsByMediaId((durations) => ({
                    ...durations,
                    [asset.id]: null,
                  }))
                }
                onLoadedMetadata={(event) => {
                  const durationMs = readDurationMs(event.currentTarget);
                  setVideoDurationMsByMediaId((durations) => ({
                    ...durations,
                    [asset.id]: durationMs,
                  }));
                }}
              />
            ))}
        </div>
        <div className="auto-shorts-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            disabled={project.scenes.length === 0 || metadataLoading}
            onClick={() => {
              setApplyError(false);
              if (!onApply(project, plan.scenes)) {
                setApplyError(true);
              }
            }}
          >
            자동 구성 적용
          </button>
        </div>
      </section>
    </div>
  );
}
