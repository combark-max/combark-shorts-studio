import { useEffect, useRef, useState } from 'react';

import { AppHeader } from './components/AppHeader';
import { AutoShortsDialog } from './components/AutoShortsDialog';
import { MediaSidebar } from './components/MediaSidebar';
import { PreviewPanel } from './components/PreviewPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RecoveryPrompt } from './components/RecoveryPrompt';
import { RecentProjects } from './components/RecentProjects';
import { TimelineShell } from './components/TimelineShell';
import { useProjectController } from './project/useProjectController';
import type { ProjectDocument } from '../shared/project/types';

function getExportProgressMessage(
  progress: ReturnType<typeof useProjectController>['exportProgress'],
): string {
  switch (progress?.stage) {
    case 'preparing':
      return '내보내기 준비 중...';
    case 'scene':
      return `장면 ${progress.sceneIndex}/${progress.sceneCount} 처리 중...`;
    case 'concatenating':
      return '장면 합치는 중...';
    case 'muxing-audio':
      return '오디오 합치는 중...';
    case 'writing-output':
      return '파일 저장 중...';
    case 'complete':
      return 'MP4 내보내기 완료';
    default:
      return '내보내기 준비 중...';
  }
}

export function App() {
  const [appVersion, setAppVersion] = useState('—');
  const [autoShortsProject, setAutoShortsProject] =
    useState<ProjectDocument | null>(null);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number | null>(
    null,
  );
  const {
    state,
    newProject,
    importMedia,
    selectNarration,
    removeNarration,
    relinkMedia,
    relinkNarration,
    applyAutoShorts,
    moveScene,
    duplicateScene,
    deleteScene,
    updateSceneDuration,
    updateSceneSubtitle,
    updateSceneSubtitlePosition,
    updateSceneSubtitleSize,
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
    recentProjectRemoveError,
    retryRecentProjects,
    openRecentProject,
    removeRecentProject,
    projectOpenError,
    projectSaveStatus,
    projectTransitionError,
    missingMediaIds,
    narrationMissing,
    sourceCheckFailed,
    exportStatus,
    exportProgress,
    exportMp4,
  } = useProjectController();
  const previousProjectRef = useRef(state.project);

  useEffect(() => {
    window.combarkDesktop
      .getAppVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion('—'));
  }, []);

  useEffect(() => {
    const documentReplaced =
      previousProjectRef.current !== state.project && !state.dirty;
    previousProjectRef.current = state.project;

    setSelectedSceneIndex((currentIndex) => {
      if (state.project.scenes.length === 0) {
        return null;
      }

      if (
        documentReplaced ||
        currentIndex === null ||
        currentIndex < 0 ||
        currentIndex >= state.project.scenes.length
      ) {
        return 0;
      }

      return currentIndex;
    });
  }, [state.dirty, state.project]);

  const handleMoveScene = (
    sceneIndex: number,
    direction: 'up' | 'down',
  ): void => {
    const targetIndex = direction === 'up' ? sceneIndex - 1 : sceneIndex + 1;

    if (!moveScene(sceneIndex, direction)) {
      return;
    }

    setSelectedSceneIndex((currentIndex) => {
      if (currentIndex === sceneIndex) {
        return targetIndex;
      }

      if (currentIndex === targetIndex) {
        return sceneIndex;
      }

      return currentIndex;
    });
  };

  const handleDuplicateScene = (sceneIndex: number): void => {
    if (duplicateScene(sceneIndex)) {
      setSelectedSceneIndex(sceneIndex + 1);
    }
  };

  const handleDeleteScene = (sceneIndex: number): void => {
    if (!deleteScene(sceneIndex)) {
      return;
    }

    const remainingSceneCount = state.project.scenes.length - 1;
    setSelectedSceneIndex((currentIndex) => {
      if (remainingSceneCount === 0) {
        return null;
      }

      if (currentIndex === null) {
        return 0;
      }

      if (currentIndex > sceneIndex) {
        return currentIndex - 1;
      }

      if (currentIndex === sceneIndex) {
        return Math.min(sceneIndex, remainingSceneCount - 1);
      }

      return currentIndex;
    });
  };

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
        onAutoShorts={() => setAutoShortsProject(state.project)}
        autoShortsDisabled={exportStatus === 'exporting'}
        onExport={() => {
          void exportMp4();
        }}
        exportInProgress={exportStatus === 'exporting'}
      />
      {autoShortsProject ? (
        <AutoShortsDialog
          project={autoShortsProject}
          missingMediaIds={missingMediaIds}
          narrationMissing={narrationMissing}
          onCancel={() => setAutoShortsProject(null)}
          onApply={(projectSnapshot, scenes) => {
            const accepted = applyAutoShorts(projectSnapshot, scenes);
            if (accepted) {
              setAutoShortsProject(null);
            }
            return accepted;
          }}
        />
      ) : null}
      <div className="save-status-slot">
        <div
          aria-label="저장 상태"
          className={
            projectSaveStatus === 'saving'
              ? 'save-status'
              : projectSaveStatus === 'success'
                ? 'save-status save-status-success'
                : undefined
          }
          role="status"
        >
          {projectSaveStatus === 'saving' ? '저장 중...' : null}
          {projectSaveStatus === 'success' ? '저장 완료' : null}
        </div>
        {projectSaveStatus === 'error' ? (
          <div
            aria-label="저장 상태"
            className="save-status save-status-error"
            role="alert"
          >
            프로젝트를 저장하지 못했습니다. 다시 시도해 주세요.
          </div>
        ) : null}
      </div>
      {projectTransitionError ? (
        <div className="save-status-slot">
          <div className="save-status save-status-error" role="alert">
            변경 사항을 안전하게 정리하지 못했습니다. 다시 시도해 주세요.
          </div>
        </div>
      ) : null}
      <div className="save-status-slot">
        {exportStatus === 'exporting' || exportStatus === 'success' ? (
          <div
            aria-label="내보내기 상태"
            className={
              exportStatus === 'success'
                ? 'save-status save-status-success'
                : 'save-status'
            }
            role="status"
          >
            {getExportProgressMessage(exportProgress)}
          </div>
        ) : null}
        {exportStatus === 'error' ? (
          <div
            aria-label="내보내기 상태"
            className="save-status save-status-error"
            role="alert"
          >
            MP4 파일을 내보내지 못했습니다. 원본 파일과 설정을 확인해 주세요.
          </div>
        ) : null}
      </div>
      <RecentProjects
        projects={recentProjects}
        loading={recentProjectsLoading}
        listFailed={recentProjectsListFailed}
        openError={recentProjectOpenError}
        onRetry={retryRecentProjects}
        onOpen={openRecentProject}
        onRemove={removeRecentProject}
        removeError={recentProjectRemoveError}
      />
      <main className="workspace">
        <MediaSidebar
          media={state.project.media}
          narration={state.project.narration}
          missingMediaIds={missingMediaIds}
          narrationMissing={narrationMissing}
          sourceCheckFailed={sourceCheckFailed}
          onAddMedia={importMedia}
          onRelinkMedia={relinkMedia}
          onRelinkNarration={relinkNarration}
          onRemoveNarration={removeNarration}
          onSelectNarration={selectNarration}
        />
        <PreviewPanel
          media={state.project.media}
          narration={state.project.narration}
          scenes={state.project.scenes}
          selectedSceneIndex={selectedSceneIndex}
          onSelectScene={setSelectedSceneIndex}
        />
        <PropertiesPanel />
      </main>
      <TimelineShell
        media={state.project.media}
        scenes={state.project.scenes}
        selectedSceneIndex={selectedSceneIndex}
        onSelectScene={setSelectedSceneIndex}
        onMoveScene={handleMoveScene}
        onDuplicateScene={handleDuplicateScene}
        onDeleteScene={handleDeleteScene}
        onUpdateSceneDuration={updateSceneDuration}
        onUpdateSceneSubtitle={updateSceneSubtitle}
        onUpdateSceneSubtitlePosition={updateSceneSubtitlePosition}
        onUpdateSceneSubtitleSize={updateSceneSubtitleSize}
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
