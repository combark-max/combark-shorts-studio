import { useEffect, useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { MediaSidebar } from './components/MediaSidebar';
import { PreviewPanel } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RecoveryPrompt } from './components/RecoveryPrompt';
import { RecentProjects } from './components/RecentProjects';
import { TimelineShell } from './components/TimelineShell';
import { useProjectController } from './project/useProjectController';

const noop = (): void => undefined;

export function App() {
  const [appVersion, setAppVersion] = useState('—');
  const {
    state,
    newProject,
    importMedia,
    moveScene,
    deleteScene,
    updateSceneDuration,
    openProject,
    saveProject,
    saveProjectAs,
    recoveryCandidates,
    recoveryListFailed,
    discardFailedProjectId,
    retryRecoveryList,
    recoverProject,
    discardRecovery,
    recentProjects,
    recentProjectsLoading,
    recentProjectsListFailed,
    recentProjectOpenError,
    retryRecentProjects,
    openRecentProject,
    projectOpenError,
  } = useProjectController();

  useEffect(() => {
    window.combarkDesktop
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion('—'));
  }, []);

  if (recoveryListFailed) {
    return (
      <main role="alert">
        <p>복구 파일을 확인하지 못했습니다.</p>
        <button
          type="button"
          onClick={() => {
            void retryRecoveryList();
          }}
        >
          다시 시도
        </button>
      </main>
    );
  }

  if (recoveryCandidates === null) {
    return <main aria-live="polite">복구 파일 확인 중...</main>;
  }

  if (recoveryCandidates.length > 0) {
    return (
      <RecoveryPrompt
        candidates={recoveryCandidates}
        discardFailedProjectId={discardFailedProjectId}
        onRecover={recoverProject}
        onDiscard={discardRecovery}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        onNewProject={newProject}
        onOpenProject={openProject}
        onSaveProject={saveProject}
        onSaveProjectAs={saveProjectAs}
        onAutoShorts={noop}
        onExport={noop}
      />
      <RecentProjects
        projects={recentProjects}
        loading={recentProjectsLoading}
        listFailed={recentProjectsListFailed}
        openError={recentProjectOpenError}
        onRetry={retryRecentProjects}
        onOpen={openRecentProject}
      />
      <main className="workspace">
        <MediaSidebar
          media={state.project.media}
          onAddMedia={importMedia}
        />
        <PreviewPanel />
        <PropertiesPanel />
      </main>
      <TimelineShell
        media={state.project.media}
        scenes={state.project.scenes}
        onMoveScene={moveScene}
        onDeleteScene={deleteScene}
        onUpdateSceneDuration={updateSceneDuration}
      />
      <footer className="app-footer">
        {projectOpenError ? (
          <span role="alert">
            프로젝트를 열지 못했습니다. 유효한 .cssproj 파일인지 확인해 주세요.
          </span>
        ) : null}
        <span>{state.project.name}</span>
        <span>{state.dirty ? '저장 필요' : '저장됨'}</span>
        <span>v{appVersion}</span>
      </footer>
    </div>
  );
}
