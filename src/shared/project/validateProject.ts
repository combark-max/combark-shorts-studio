import type {
  MediaAsset,
  ProjectDocument,
  Scene,
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
const PROJECT_V3_KEYS = [...PROJECT_V2_KEYS, 'scenes'] as const;
const PROJECT_V4_KEYS = PROJECT_V3_KEYS;

const SETTINGS_KEYS = ['width', 'height', 'fps'] as const;
const MEDIA_KEYS = ['id', 'kind', 'sourcePath', 'fileName'] as const;
const SCENE_V3_KEYS = ['mediaId', 'durationMs'] as const;
const SCENE_V4_KEYS = [...SCENE_V3_KEYS, 'subtitle'] as const;

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
  const isV3 = value.schemaVersion === 3;
  const isV4 = value.schemaVersion === 4;
  const projectKeys = isV1
    ? PROJECT_V1_KEYS
    : isV2
      ? PROJECT_V2_KEYS
      : isV3
        ? PROJECT_V3_KEYS
        : PROJECT_V4_KEYS;

  if (
    (!isV1 && !isV2 && !isV3 && !isV4) ||
    !hasExactKeys(value, projectKeys)
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

  if (isV2 || isV3 || isV4) {
    if (!Array.isArray(value.media)) {
      throw new Error(INVALID_PROJECT_MESSAGE);
    }

    const mediaIds = new Set<string>();
    media = value.media.map((asset): MediaAsset => {
      if (
        !isRecord(asset) ||
        !hasExactKeys(asset, MEDIA_KEYS) ||
        typeof asset.id !== 'string' ||
        asset.id.length === 0 ||
        mediaIds.has(asset.id) ||
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

      mediaIds.add(asset.id);
      return {
        id: asset.id,
        kind: asset.kind,
        sourcePath: asset.sourcePath,
        fileName: asset.fileName,
      };
    });
  }

  let scenes: Scene[];

  if (isV3 || isV4) {
    if (!Array.isArray(value.scenes)) {
      throw new Error(INVALID_PROJECT_MESSAGE);
    }

    const mediaById = new Map(media.map((asset) => [asset.id, asset]));
    const sceneMediaIds = new Set<string>();

    scenes = value.scenes.map((scene): Scene => {
      if (
        !isRecord(scene) ||
        !hasExactKeys(scene, isV4 ? SCENE_V4_KEYS : SCENE_V3_KEYS) ||
        typeof scene.mediaId !== 'string' ||
        scene.mediaId.length === 0 ||
        sceneMediaIds.has(scene.mediaId) ||
        (isV4 && typeof scene.subtitle !== 'string')
      ) {
        throw new Error(INVALID_PROJECT_MESSAGE);
      }

      const asset = mediaById.get(scene.mediaId);
      if (!asset) {
        throw new Error(INVALID_PROJECT_MESSAGE);
      }

      if (
        (asset.kind === 'image' &&
          (!Number.isInteger(scene.durationMs) ||
            (scene.durationMs as number) <= 0)) ||
        (asset.kind === 'video' && scene.durationMs !== null)
      ) {
        throw new Error(INVALID_PROJECT_MESSAGE);
      }

      sceneMediaIds.add(scene.mediaId);
      return {
        mediaId: scene.mediaId,
        durationMs: scene.durationMs as number | null,
        subtitle: isV4 ? (scene.subtitle as string) : '',
      };
    });
  } else if (isV2) {
    scenes = media.map((asset) => ({
      mediaId: asset.id,
      durationMs: asset.kind === 'image' ? 3000 : null,
      subtitle: '',
    }));
  } else {
    scenes = [];
  }

  return {
    schemaVersion: 4,
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
    scenes,
  };
}
