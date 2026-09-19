import { createNewProject } from '../../shared/project/createProject';
import type { ProjectDocumentV1 } from '../../shared/project/types';

export interface ProjectState {
  project: ProjectDocumentV1;
  filePath: string | null;
  dirty: boolean;
  lastSavedAt: string | null;
}

export function createInitialProjectState(): ProjectState {
  return {
    project: createNewProject(),
    filePath: null,
    dirty: false,
    lastSavedAt: null,
  };
}