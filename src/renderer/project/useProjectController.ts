import { useEffect, useRef, useState } from 'react';

import { createInitialProjectState } from './projectState';
import type { ProjectState } from './projectState';
import type {
  RecentProject,
  RecoveryCandidate,
} from '../../shared/project/types';

const RECOVERY_AUTOSAVE_INTERVAL_MS = 30_000;

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
  const [projectOpenError, setProjectOpenError] = useState(false);
  const stateRef = useRef(state);
  const recoveryWriteRef = useRef<Promise<void> | null>(null);
  const manualSaveInProgressCountRef = useRef(0);
  const documentGenerationRef = useRef(0);
  const saveSequenceRef = useRef(0);
  stateRef.current = state;

  const replaceState = (nextState: ProjectState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const replaceDocumentState = (nextState: ProjectState): void => {
    documentGenerationRef.current += 1;
    replaceState(nextState);
  };

  const finishManualSave = (
    filePath: string,
    savedProject: ProjectState['project'],
    documentGeneration: number,
    saveSequence: number,
  ): void => {
    if (
      documentGenerationRef.current !== documentGeneration ||
      saveSequenceRef.current !== saveSequence ||
      stateRef.current.project.projectId !== savedProject.projectId
    ) {
      return;
    }

    const nextState = {
      ...stateRef.current,
      filePath,
      dirty: stateRef.current.project !== savedProject,
      lastSavedAt: new Date().toISOString(),
    };
    replaceState(nextState);
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

  useEffect(() => {
    void retryRecoveryList();
  }, []);

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
    const filePath = await window.combarkDesktop.saveProjectDialog(project.name);

    if (!filePath || documentGenerationRef.current !== documentGeneration) {
      return;
    }

    manualSaveInProgressCountRef.current += 1;

    try {
      await window.combarkDesktop.writeProject(filePath, project);
      await deleteRecoveryAfterSave(project.projectId);
      finishManualSave(
        filePath,
        project,
        documentGeneration,
        saveSequence,
      );
      await loadRecentProjects(false);
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
    manualSaveInProgressCountRef.current += 1;

    try {
      await window.combarkDesktop.writeProject(
        currentState.filePath,
        currentState.project,
      );
      await deleteRecoveryAfterSave(currentState.project.projectId);
      finishManualSave(
        currentState.filePath,
        currentState.project,
        documentGeneration,
        saveSequence,
      );
      await loadRecentProjects(false);
    } finally {
      manualSaveInProgressCountRef.current -= 1;
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
    retryRecentProjects,
    openRecentProject,
    projectOpenError,
    newProject,
    importMedia,
    openProject,
    saveProject,
    saveProjectAs,
  };
}
