import type {
  MediaAsset,
  NarrationAsset,
} from '../../shared/project/types';

export interface MediaSidebarProps {
  media: MediaAsset[];
  narration: NarrationAsset | null;
  missingMediaIds: readonly string[];
  narrationMissing: boolean;
  sourceCheckFailed: boolean;
  onAddMedia(): Promise<void>;
  onRelinkMedia(mediaId: string): Promise<void>;
  onRelinkNarration(): Promise<void>;
  onRemoveNarration(): void;
  onSelectNarration(): Promise<void>;
}

export function MediaSidebar({
  media,
  narration,
  missingMediaIds,
  narrationMissing,
  sourceCheckFailed,
  onAddMedia,
  onRelinkMedia,
  onRelinkNarration,
  onRemoveNarration,
  onSelectNarration,
}: MediaSidebarProps) {
  const missingMediaIdSet = new Set(missingMediaIds);

  return (
    <aside className="panel media-sidebar" aria-label="미디어">
      <div className="media-import-controls">
        <div className="media-import-control">
          <span className="media-import-label">사진/영상</span>
          <button
            type="button"
            onClick={() => {
              void onAddMedia();
            }}
          >
            파일 추가
          </button>
        </div>
        <div className="narration-control">
          <span className="media-import-label">내레이션</span>
          <button
            type="button"
            onClick={() => {
              void onSelectNarration();
            }}
          >
            {narration
              ? 'MP3/WAV 내레이션 교체'
              : 'MP3/WAV 내레이션 선택'}
          </button>
          {narration ? (
            <>
              <span className="narration-file-name">{narration.fileName}</span>
              {narrationMissing ? (
                <>
                  <span className="source-missing-status">
                    내레이션 원본 파일 없음
                  </span>
                  <span className="source-path">{narration.sourcePath}</span>
                  <button
                    type="button"
                    aria-label={`${narration.fileName} 파일 다시 찾기`}
                    onClick={() => {
                      void onRelinkNarration();
                    }}
                  >
                    파일 다시 찾기
                  </button>
                </>
              ) : null}
              <button type="button" onClick={onRemoveNarration}>
                내레이션 제거
              </button>
            </>
          ) : null}
        </div>
      </div>
      {sourceCheckFailed ? (
        <p className="source-check-error" role="status">
          원본 파일 상태를 확인하지 못했습니다.
        </p>
      ) : null}
      {media.length === 0 ? (
        <p className="media-empty">추가된 미디어가 없습니다.</p>
      ) : (
        <ul className="media-list">
          {media.map((asset) => {
            const isMissing = missingMediaIdSet.has(asset.id);

            return (
              <li
                className={isMissing ? 'media-missing' : undefined}
                key={asset.id}
              >
                <span className="media-name">{asset.fileName}</span>
                <span className="media-kind">
                  {asset.kind === 'image' ? '이미지' : '영상'}
                </span>
                {isMissing ? (
                  <>
                    <span className="source-missing-status">원본 파일 없음</span>
                    <span className="source-path">{asset.sourcePath}</span>
                    <button
                      type="button"
                      aria-label={`${asset.fileName} 파일 다시 찾기`}
                      onClick={() => {
                        void onRelinkMedia(asset.id);
                      }}
                    >
                      파일 다시 찾기
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <nav aria-label="미디어 도구">
        <ul className="sidebar-items">
          <li>미디어</li>
          <li>텍스트</li>
          <li>전환효과</li>
          <li>AI 음성</li>
        </ul>
      </nav>
    </aside>
  );
}
