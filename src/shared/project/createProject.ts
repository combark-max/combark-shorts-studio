import { DEFAULT_PROJECT_SETTINGS } from '../appInfo';
import type { ProjectDocumentV1 } from './types';

export function createNewProject(
  name = '새 프로젝트',
): ProjectDocumentV1 {
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    projectId: globalThis.crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: DEFAULT_PROJECT_SETTINGS,
  };
}