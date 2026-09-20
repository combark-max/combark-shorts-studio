import type { MediaAsset } from '../../shared/project/types';

export interface MediaSidebarProps {
  media: MediaAsset[];
  onAddMedia(): Promise<void>;
}

export function MediaSidebar({ media, onAddMedia }: MediaSidebarProps) {
  return (
    <aside className="panel media-sidebar" aria-label="미디어">
      <button
        type="button"
        onClick={() => {
          void onAddMedia();
        }}
      >
        파일 추가
      </button>
      {media.length === 0 ? (
        <p className="media-empty">추가된 미디어가 없습니다.</p>
      ) : (
        <ul className="media-list">
          {media.map((asset) => (
            <li key={asset.id}>
              <span className="media-name">{asset.fileName}</span>
              <span className="media-kind">
                {asset.kind === 'image' ? '이미지' : '영상'}
              </span>
            </li>
          ))}
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
