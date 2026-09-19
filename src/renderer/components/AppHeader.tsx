export interface AppHeaderProps {
  onNewProject(): void;
  onOpenProject(): void;
  onSaveProject(): void;
  onSaveProjectAs(): void;
  onAutoShorts(): void;
  onExport(): void;
}

export function AppHeader({
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onAutoShorts,
  onExport,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>Combark Shorts Studio</h1>
      <nav className="header-actions" aria-label="앱 작업">
        <button type="button" onClick={onNewProject}>새 프로젝트</button>
        <button type="button" onClick={onOpenProject}>열기</button>
        <button type="button" onClick={onSaveProject}>저장</button>
        <button type="button" onClick={onSaveProjectAs}>다른 이름으로 저장</button>
        <button type="button" onClick={onAutoShorts}>쇼츠 자동 만들기</button>
        <button type="button" onClick={onExport}>YouTube Shorts로 내보내기</button>
      </nav>
    </header>
  );
}