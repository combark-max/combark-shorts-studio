import type {
  MediaAsset,
  ProjectDocument,
} from './types';
import { getMediaKind } from './media';

const INVALID_PROJECT_MESSAGE = '유효하지 않은 프로젝트 파일입니다.';

const PROJECT_V1_KEYS = [
  'schemaVersion',
  'projectId',
  'name',
  'createdAt',
  'updatedAt',
  'settings',
] as const;

const PROJECT_V2_KEYS = [...PROJECT_V1_KEYS, 'media'] as const;

const SETTINGS_KEYS = ['width', 'height', 'fps'] as const;
const MEDIA_KEYS = ['id', 'kind', 'sourcePath', 'fileName'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function validateProjectDocument(
  value: unknown,
): ProjectDocument {
  if (!isRecord(value)) {
    throw new Error(INVALID_PROJECT_MESSAGE);
  }

  const isV1 = value.schemaVersion === 1;
  const isV2 = value.schemaVersion === 2;

  if (
    (!isV1 && !isV2) ||
    !hasExactKeys(value, isV1 ? PROJECT_V1_KEYS : PROJECT_V2_KEYS)
  ) {
    throw new Error(INVALID_PROJECT_MESSAGE);
  }

  const settings = value.settings;

  if (
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

  let media: MediaAsset[] = [];

  if (isV2) {
    if (!Array.isArray(value.media)) {
      throw new Error(INVALID_PROJECT_MESSAGE);
    }

    media = value.media.map((asset): MediaAsset => {
      if (
        !isRecord(asset) ||
        !hasExactKeys(asset, MEDIA_KEYS) ||
        typeof asset.id !== 'string' ||
        asset.id.length === 0 ||
        (asset.kind !== 'image' && asset.kind !== 'video') ||
        typeof asset.sourcePath !== 'string' ||
        asset.sourcePath.length === 0 ||
        !isAbsoluteWindowsPath(asset.sourcePath) ||
        getMediaKind(asset.sourcePath) !== asset.kind ||
        typeof asset.fileName !== 'string' ||
        asset.fileName.length === 0
      ) {
        throw new Error(INVALID_PROJECT_MESSAGE);
      }

      return {
        id: asset.id,
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        fileName: asset.fileName,
      };
    });
  }

  return {
    schemaVersion: 2,
    projectId: value.projectId,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    settings: {
      width: 1080,
      height: 1920,
      fps: 30,
    },
    media,
  };
}
