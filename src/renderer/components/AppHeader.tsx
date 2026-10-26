export interface AppHeaderProps {
  onNewProject(): void;
  onOpenProject(): void;
  onSaveProject(): void;
  onSaveProjectAs(): void;
  onAutoShorts(): void;
  autoShortsDisabled: boolean;
  onContactSheetVideo(): void;
  contactSheetVideoDisabled: boolean;
  onVideoDiagnostics(): void;
  videoDiagnosticsDisabled: boolean;
  onVideoFinalCorrection(): void;
  videoFinalCorrectionDisabled: boolean;
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
  onVideoDiagnostics,
  videoDiagnosticsDisabled,
  onVideoFinalCorrection,
  videoFinalCorrectionDisabled,
  onExport,
  exportInProgress,
  exportDisabled,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>Combark Shorts Studio</h1>
      <nav className="header-actions" aria-label="앱 작업">
        <div
          aria-label="프로젝트 관리"
          className="header-action-group"
          role="group"
        >
          <span className="header-action-group-label">프로젝트 관리</span>
          <button type="button" onClick={onNewProject}>새 프로젝트</button>
          <button type="button" onClick={onOpenProject}>열기</button>
          <button type="button" onClick={onSaveProject}>저장</button>
          <button type="button" onClick={onSaveProjectAs}>
            다른 이름으로 저장
          </button>
        </div>
        <div
          aria-label="영상 제작"
          className="header-action-group"
          role="group"
        >
          <span className="header-action-group-label">영상 제작</span>
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
          <button
            type="button"
            onClick={onVideoDiagnostics}
            disabled={videoDiagnosticsDisabled}
          >
            영상 최종 보정 진단
          </button>
          <button
            type="button"
            onClick={onVideoFinalCorrection}
            disabled={videoFinalCorrectionDisabled}
          >
            영상 최종 보정
          </button>
        </div>
        <div
          aria-label="내보내기"
          className="header-action-group header-action-group-export"
          role="group"
        >
          <span className="header-action-group-label">내보내기</span>
          <button type="button" onClick={onExport} disabled={exportDisabled}>
            {exportInProgress ? '내보내는 중...' : 'MP4 내보내기'}
          </button>
        </div>
      </nav>
    </header>
  );
}
