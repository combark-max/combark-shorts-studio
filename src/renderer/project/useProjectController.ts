import { useEffect, useRef, useState } from 'react';

import { createInitialProjectState } from './projectState';
import type { ProjectState } from './projectState';

const RECOVERY_AUTOSAVE_INTERVAL_MS = 30_000;

export function useProjectController(initialState?: ProjectState) {
  const [state, setState] = useState<ProjectState>(
    () => initialState ?? createInitialProjectState(),
  );
  const stateRef = useRef(state);
  const recoveryWriteRef = useRef<Promise<void> | null>(null);
  const manualSaveInProgressRef = useRef(false);
  stateRef.current = state;

  const replaceState = (nextState: ProjectState): void => {
    stateRef.current = nextState;
    setState(nextState);
  };

  const finishManualSave = (filePath: string): void => {
    const nextState = {
      ...stateRef.current,
      filePath,
      dirty: false,
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

  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentState = stateRef.current;

      if (
        !currentState.dirty ||
        manualSaveInProgressRef.current ||
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
    replaceState(createInitialProjectState());
  };

  const openProject = async () => {
    const filePath = await window.combarkDesktop.openProjectDialog();

    if (!filePath) {
      return;
    }

    const project = await window.combarkDesktop.readProject(filePath);
    replaceState({
      project,
      filePath,
      dirty: false,
      lastSavedAt: null,
    });
  };

  const saveProjectAs = async () => {
    const project = stateRef.current.project;
    const filePath = await window.combarkDesktop.saveProjectDialog(project.name);

    if (!filePath) {
      return;
    }

    manualSaveInProgressRef.current = true;

    try {
      await window.combarkDesktop.writeProject(filePath, project);
      await deleteRecoveryAfterSave(project.projectId);
      finishManualSave(filePath);
    } finally {
      manualSaveInProgressRef.current = false;
    }
  };

  const saveProject = async () => {
    const currentState = stateRef.current;

    if (!currentState.filePath) {
      await saveProjectAs();
      return;
    }

    manualSaveInProgressRef.current = true;

    try {
      await window.combarkDesktop.writeProject(
        currentState.filePath,
        currentState.project,
      );
      await deleteRecoveryAfterSave(currentState.project.projectId);
      finishManualSave(currentState.filePath);
    } finally {
      manualSaveInProgressRef.current = false;
    }
  };

  return {
    state,
    newProject,
    openProject,
    saveProject,
    saveProjectAs,
  };
}
