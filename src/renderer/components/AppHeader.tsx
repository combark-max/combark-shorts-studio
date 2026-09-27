export interface AppHeaderProps {
  onNewProject(): void;
  onOpenProject(): void;
  onSaveProject(): void;
  onSaveProjectAs(): void;
  onAutoShorts(): void;
  autoShortsDisabled: boolean;
  onContactSheetVideo(): void;
  contactSheetVideoDisabled: boolean;
  onExport(): void;
  exportInProgress: boolean;
  exportDisabled: boolean;
}

export function AppHeader({
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onAutoShorts,
  autoShortsDisabled,
  onContactSheetVideo,
  contactSheetVideoDisabled,
  onExport,
  exportInProgress,
  exportDisabled,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>Combark Shorts Studio</h1>
      <nav className="header-actions" aria-label="앱 작업">
        <button type="button" onClick={onNewProject}>새 프로젝트</button>
        <button type="button" onClick={onOpenProject}>열기</button>
        <button type="button" onClick={onSaveProject}>저장</button>
        <button type="button" onClick={onSaveProjectAs}>다른 이름으로 저장</button>
        <button
          type="button"
          onClick={onAutoShorts}
          disabled={autoShortsDisabled}
        >
          쇼츠 자동 만들기
        </button>
        <button
          type="button"
          onClick={onContactSheetVideo}
          disabled={contactSheetVideoDisabled}
        >
          연속 프레임 영상 만들기
        </button>
        <button type="button" onClick={onExport} disabled={exportDisabled}>
          {exportInProgress ? '내보내는 중...' : 'MP4 내보내기'}
        </button>
      </nav>
    </header>
  );
}
