import { useEffect, useRef, useState } from 'react';

import { createInitialProjectState } from './projectState';
import type { ProjectState } from './projectState';
import type { ExportProgress, ExportStatus } from '../../shared/export';
import type {
  RecentProject,
  RecoveryCandidate,
} from '../../shared/project/types';

const RECOVERY_AUTOSAVE_INTERVAL_MS = 30_000;
const SAVE_SUCCESS_FEEDBACK_MS = 2_000;

type ProjectSaveStatus = 'idle' | 'saving' | 'success' | 'error';

export function useProjectController(initialState?: ProjectState) {
  const [state, setState] = useState<ProjectState>(
    () => initialState ?? createInitialProjectState(),
  );
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    RecoveryCandidate[] | null
  >(null);
  const [recoveryListFailed, setRecoveryListFailed] = useState(false);
  const [discardFailedProjectId, setDiscardFailedProjectId] = useState<
    string | null
  >(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentProjectsLoading, setRecentProjectsLoading] = useState(true);
  const [recentProjectsListFailed, setRecentProjectsListFailed] =
    useState(false);
  const [recentProjectOpenError, setRecentProjectOpenError] = useState<
    'missing' | 'open' | null
  >(null);
  const [recentProjectRemoveError, setRecentProjectRemoveError] =
    useState(false);
  const [projectOpenError, setProjectOpenError] = useState(false);
  const [projectSaveStatus, setProjectSaveStatus] =
    useState<ProjectSaveStatus>('idle');
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportProgress, setExportProgress] =
    useState<ExportProgress | null>(null);
  const stateRef = useRef(state);
  const recoveryWriteRef = useRef<Promise<void> | null>(null);
  const manualSaveInProgressCountRef = useRef(0);
  const documentGenerationRef = useRef(0);
  const saveSequenceRef = useRef(0);
  const saveFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const exportInProgressRef = useRef(false);
  stateRef.current = state;

  const clearSaveFeedbackTimeout = (): void => {
    if (saveFeedbackTimeoutRef.current) {
      clearTimeout(saveFeedbackTimeoutRef.current);
      saveFeedbackTimeoutRef.current = null;
    }
  };

  const replaceState = (nextState: ProjectState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const replaceDocumentState = (nextState: ProjectState): void => {
    documentGenerationRef.current += 1;
    clearSaveFeedbackTimeout();
    setProjectSaveStatus('idle');
    if (!exportInProgressRef.current) {
      setExportStatus('idle');
      setExportProgress(null);
    }
    replaceState(nextState);
  };

  const finishManualSave = (
    filePath: string,
    savedProject: ProjectState['project'],
    documentGeneration: number,
    saveSequence: number,
  ): boolean => {
    if (
      documentGenerationRef.current !== documentGeneration ||
      saveSequenceRef.current !== saveSequence ||
      stateRef.current.project.projectId !== savedProject.projectId
    ) {
      return false;
    }

    const nextState = {
      ...stateRef.current,
      filePath,
      dirty: stateRef.current.project !== savedProject,
      lastSavedAt: new Date().toISOString(),
    };
    replaceState(nextState);
    return true;
  };

  const isCurrentSave = (
    documentGeneration: number,
    saveSequence: number,
  ): boolean =>
    documentGenerationRef.current === documentGeneration &&
    saveSequenceRef.current === saveSequence;

  const startSaveFeedback = (): void => {
    clearSaveFeedbackTimeout();
    setProjectSaveStatus('saving');
  };

  const finishSaveFeedback = (
    status: 'success' | 'error',
    documentGeneration: number,
    saveSequence: number,
  ): void => {
    if (!isCurrentSave(documentGeneration, saveSequence)) {
      return;
    }

    setProjectSaveStatus(status);
    if (status === 'success') {
      saveFeedbackTimeoutRef.current = setTimeout(() => {
        if (isCurrentSave(documentGeneration, saveSequence)) {
          setProjectSaveStatus('idle');
        }
        saveFeedbackTimeoutRef.current = null;
      }, SAVE_SUCCESS_FEEDBACK_MS);
    }
  };

  const deleteRecoveryAfterSave = async (projectId: string): Promise<void> => {
    const activeRecoveryWrite = recoveryWriteRef.current;

    if (activeRecoveryWrite) {
      await activeRecoveryWrite;
    }

    try {
      await window.combarkDesktop.deleteRecovery(projectId);
    } catch {
      // Recovery cleanup failure must not turn a successful project save into a failure.
    }
  };

  const retryRecoveryList = async (): Promise<void> => {
    setRecoveryCandidates(null);
    setRecoveryListFailed(false);

    try {
      setRecoveryCandidates(await window.combarkDesktop.listRecoveries());
    } catch {
      setRecoveryListFailed(true);
    }
  };

  const recoverProject = (candidate: RecoveryCandidate): void => {
    replaceDocumentState({
      project: candidate.project,
      filePath: null,
      dirty: true,
      lastSavedAt: null,
    });
    setRecoveryCandidates([]);
    setDiscardFailedProjectId(null);
  };

  const discardRecovery = async (projectId: string): Promise<void> => {
    setDiscardFailedProjectId(null);

    try {
      await window.combarkDesktop.deleteRecovery(projectId);
      setRecoveryCandidates((currentCandidates) =>
        currentCandidates?.filter(
          (candidate) => candidate.projectId !== projectId,
        ) ?? null,
      );
    } catch {
      setDiscardFailedProjectId(projectId);
    }
  };

  const loadRecentProjects = async (showLoading: boolean): Promise<void> => {
    if (showLoading) {
      setRecentProjectsLoading(true);
    }
    setRecentProjectsListFailed(false);

    try {
      setRecentProjects(await window.combarkDesktop.listRecentProjects());
    } catch {
      setRecentProjectsListFailed(true);
    } finally {
      if (showLoading) {
        setRecentProjectsLoading(false);
      }
    }
  };

  const retryRecentProjects = async (): Promise<void> => {
    await loadRecentProjects(true);
  };

  const openRecentProject = async (filePath: string): Promise<void> => {
    setRecentProjectOpenError(null);

    try {
      const result = await window.combarkDesktop.openRecentProject(filePath);

      if (result.status === 'missing') {
        setRecentProjects(result.recentProjects);
        setRecentProjectOpenError('missing');
        return;
      }

      replaceDocumentState({
        project: result.project,
        filePath: result.filePath,
        dirty: false,
        lastSavedAt: null,
      });
      await loadRecentProjects(false);
    } catch {
      setRecentProjectOpenError('open');
    }
  };

  const removeRecentProject = async (filePath: string): Promise<void> => {
    setRecentProjectRemoveError(false);

    try {
      setRecentProjects(
        await window.combarkDesktop.removeRecentProject(filePath),
      );
    } catch {
      setRecentProjectRemoveError(true);
    }
  };

  useEffect(() => {
    void retryRecoveryList();
  }, []);

  useEffect(
    () => () => {
      clearSaveFeedbackTimeout();
    },
    [],
  );

  useEffect(() => {
    void retryRecentProjects();
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentState = stateRef.current;

      if (
        !currentState.dirty ||
        manualSaveInProgressCountRef.current > 0 ||
        recoveryWriteRef.current
      ) {
        return;
      }

      const recoveryWrite = Promise.resolve()
        .then(() => window.combarkDesktop.writeRecovery(currentState.project))
        .catch((): void => undefined)
        .finally(() => {
          if (recoveryWriteRef.current === recoveryWrite) {
            recoveryWriteRef.current = null;
          }
        });
      recoveryWriteRef.current = recoveryWrite;
    }, RECOVERY_AUTOSAVE_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const newProject = () => {
    replaceDocumentState(createInitialProjectState());
  };

  const importMedia = async (): Promise<void> => {
    const media = await window.combarkDesktop.openMediaDialog();

    if (media.length === 0) {
      return;
    }

    const currentState = stateRef.current;
    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        media: [...currentState.project.media, ...media],
        scenes: [
          ...currentState.project.scenes,
          ...media.map((asset) => ({
            mediaId: asset.id,
            durationMs: asset.kind === 'image' ? 3000 : null,
            subtitle: '',
          })),
        ],
      },
      dirty: true,
    });
  };

  const selectNarration = async (): Promise<void> => {
    const narration = await window.combarkDesktop.openNarrationDialog();

    if (!narration) {
      return;
    }

    const currentState = stateRef.current;
    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        narration,
      },
      dirty: true,
    });
  };

  const moveScene = (mediaId: string, direction: 'up' | 'down'): void => {
    const currentState = stateRef.current;
    const currentIndex = currentState.project.scenes.findIndex(
      (scene) => scene.mediaId === mediaId,
    );
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= currentState.project.scenes.length
    ) {
      return;
    }

    const scenes = [...currentState.project.scenes];
    [scenes[currentIndex], scenes[targetIndex]] = [
      scenes[targetIndex],
      scenes[currentIndex],
    ];
    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        scenes,
      },
      dirty: true,
    });
  };

  const deleteScene = (mediaId: string): void => {
    const currentState = stateRef.current;
    const scenes = currentState.project.scenes.filter(
      (scene) => scene.mediaId !== mediaId,
    );

    if (scenes.length === currentState.project.scenes.length) {
      return;
    }

    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        media: currentState.project.media.filter(
          (asset) => asset.id !== mediaId,
        ),
        scenes,
      },
      dirty: true,
    });
  };

  const updateSceneDuration = (mediaId: string, durationMs: number): void => {
    const currentState = stateRef.current;
    const asset = currentState.project.media.find(({ id }) => id === mediaId);
    const scene = currentState.project.scenes.find(
      (candidate) => candidate.mediaId === mediaId,
    );

    if (
      asset?.kind !== 'image' ||
      !scene ||
      !Number.isInteger(durationMs) ||
      durationMs <= 0 ||
      scene.durationMs === durationMs
    ) {
      return;
    }

    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        scenes: currentState.project.scenes.map((candidate) =>
          candidate.mediaId === mediaId
            ? { ...candidate, durationMs }
            : candidate,
        ),
      },
      dirty: true,
    });
  };

  const updateSceneSubtitle = (mediaId: string, subtitle: string): void => {
    const currentState = stateRef.current;
    const scene = currentState.project.scenes.find(
      (candidate) => candidate.mediaId === mediaId,
    );

    if (!scene || scene.subtitle === subtitle) {
      return;
    }

    replaceState({
      ...currentState,
      project: {
        ...currentState.project,
        updatedAt: new Date().toISOString(),
        scenes: currentState.project.scenes.map((candidate) =>
          candidate.mediaId === mediaId
            ? { ...candidate, subtitle }
            : candidate,
        ),
      },
      dirty: true,
    });
  };

  const openProject = async () => {
    setProjectOpenError(false);
    let filePath: string | null;

    try {
      filePath = await window.combarkDesktop.openProjectDialog();
    } catch {
      setProjectOpenError(true);
      return;
    }

    if (!filePath) {
      return;
    }

    let project: ProjectState['project'];

    try {
      project = await window.combarkDesktop.readProject(filePath);
    } catch {
      setProjectOpenError(true);
      return;
    }

    replaceDocumentState({
      project,
      filePath,
      dirty: false,
      lastSavedAt: null,
    });
    await loadRecentProjects(false);
  };

  const saveProjectAs = async () => {
    const documentGeneration = documentGenerationRef.current;
    const saveSequence = ++saveSequenceRef.current;
    const project = stateRef.current.project;
    startSaveFeedback();
    let filePath: string | null;

    try {
      filePath = await window.combarkDesktop.saveProjectDialog(project.name);
    } catch {
      finishSaveFeedback('error', documentGeneration, saveSequence);
      return;
    }

    if (!filePath || documentGenerationRef.current !== documentGeneration) {
      if (isCurrentSave(documentGeneration, saveSequence)) {
        setProjectSaveStatus('idle');
      }
      return;
    }

    manualSaveInProgressCountRef.current += 1;

    try {
      await window.combarkDesktop.writeProject(filePath, project);
      await deleteRecoveryAfterSave(project.projectId);
      const saveApplied = finishManualSave(
        filePath,
        project,
        documentGeneration,
        saveSequence,
      );
      await loadRecentProjects(false);
      if (saveApplied) {
        finishSaveFeedback('success', documentGeneration, saveSequence);
      }
    } catch {
      finishSaveFeedback('error', documentGeneration, saveSequence);
    } finally {
      manualSaveInProgressCountRef.current -= 1;
    }
  };

  const saveProject = async () => {
    const currentState = stateRef.current;

    if (!currentState.filePath) {
      await saveProjectAs();
      return;
    }

    const documentGeneration = documentGenerationRef.current;
    const saveSequence = ++saveSequenceRef.current;
    startSaveFeedback();
    manualSaveInProgressCountRef.current += 1;

    try {
      await window.combarkDesktop.writeProject(
        currentState.filePath,
        currentState.project,
      );
      await deleteRecoveryAfterSave(currentState.project.projectId);
      const saveApplied = finishManualSave(
        currentState.filePath,
        currentState.project,
        documentGeneration,
        saveSequence,
      );
      await loadRecentProjects(false);
      if (saveApplied) {
        finishSaveFeedback('success', documentGeneration, saveSequence);
      }
    } catch {
      finishSaveFeedback('error', documentGeneration, saveSequence);
    } finally {
      manualSaveInProgressCountRef.current -= 1;
    }
  };

  const exportMp4 = async (): Promise<void> => {
    if (exportInProgressRef.current) {
      return;
    }

    exportInProgressRef.current = true;
    setExportStatus('exporting');
    setExportProgress({ stage: 'preparing' });
    const stopListening = window.combarkDesktop.onExportProgress(
      setExportProgress,
    );
    try {
      const result = await window.combarkDesktop.exportMp4(
        stateRef.current.project,
      );
      if (result.status === 'success') {
        setExportStatus('success');
        setExportProgress({ stage: 'complete' });
      } else {
        setExportStatus('idle');
        setExportProgress(null);
      }
    } catch {
      setExportStatus('error');
      setExportProgress(null);
    } finally {
      stopListening();
      exportInProgressRef.current = false;
    }
  };

  return {
    state,
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
    exportStatus,
    exportProgress,
    newProject,
    importMedia,
    selectNarration,
    moveScene,
    deleteScene,
    updateSceneDuration,
    updateSceneSubtitle,
    openProject,
    saveProject,
    saveProjectAs,
    exportMp4,
  };
}
