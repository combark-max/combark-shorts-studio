import type { ProjectDocumentV1 } from './types';

const INVALID_PROJECT_MESSAGE = '유효하지 않은 프로젝트 파일입니다.';

const PROJECT_KEYS = [
  'schemaVersion',
  'projectId',
  'name',
  'createdAt',
  'updatedAt',
  'settings',
] as const;

const SETTINGS_KEYS = ['width', 'height', 'fps'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

export function validateProjectDocument(
  value: unknown,
): ProjectDocumentV1 {
  if (!isRecord(value) || !hasExactKeys(value, PROJECT_KEYS)) {
    throw new Error(INVALID_PROJECT_MESSAGE);
  }

  const settings = value.settings;

  if (
    value.schemaVersion !== 1 ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.createdAt !== 'string' ||
    value.createdAt.length === 0 ||
    typeof value.updatedAt !== 'string' ||
    value.updatedAt.length === 0 ||
    !isRecord(settings) ||
    !hasExactKeys(settings, SETTINGS_KEYS) ||
    settings.width !== 1080 ||
    settings.height !== 1920 ||
    settings.fps !== 30
  ) {
    throw new Error(INVALID_PROJECT_MESSAGE);
  }

  return {
    schemaVersion: 1,
    projectId: value.projectId,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    settings: {
      width: 1080,
      height: 1920,
      fps: 30,
    },
  };
}