import { DEFAULT_PROJECT_SETTINGS } from '../appInfo';
import type { ProjectDocument } from './types';

export function createNewProject(
  name = '새 프로젝트',
): ProjectDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: 2,
    projectId: globalThis.crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: DEFAULT_PROJECT_SETTINGS,
    media: [],
  };
}
