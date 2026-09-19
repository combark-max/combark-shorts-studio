import { useState } from 'react';

import { createInitialProjectState } from './projectState';
import type { ProjectState } from './projectState';

export function useProjectController() {
  const [state, setState] = useState<ProjectState>(createInitialProjectState);

  const newProject = () => {
    setState(createInitialProjectState());
  };

  const openProject = async () => {
    const filePath = await window.combarkDesktop.openProjectDialog();

    if (!filePath) {
      return;
    }

    const project = await window.combarkDesktop.readProject(filePath);
    setState({
      project,
      filePath,
      dirty: false,
      lastSavedAt: null,
    });
  };

  const saveProjectAs = async () => {
    const filePath = await window.combarkDesktop.saveProjectDialog(state.project.name);

    if (!filePath) {
      return;
    }

    await window.combarkDesktop.writeProject(filePath, state.project);
    setState((currentState) => ({
      ...currentState,
      filePath,
      dirty: false,
      lastSavedAt: new Date().toISOString(),
    }));
  };

  const saveProject = async () => {
    if (!state.filePath) {
      await saveProjectAs();
      return;
    }

    await window.combarkDesktop.writeProject(state.filePath, state.project);
    setState((currentState) => ({
      ...currentState,
      dirty: false,
      lastSavedAt: new Date().toISOString(),
    }));
  };

  return {
    state,
    newProject,
    openProject,
    saveProject,
    saveProjectAs,
  };
}