import type {
  MediaAsset,
  NarrationAsset,
  ProjectDocument,
  Scene,
} from './types';
import { getMediaKind, isSupportedNarrationPath } from './media';
import {
  DEFAULT_SUBTITLE_POSITION,
  DEFAULT_SUBTITLE_SIZE,
} from './subtitleStyle';

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
const PROJECT_V5_KEYS = [...PROJECT_V4_KEYS, 'narration'] as const;
const PROJECT_V6_KEYS = PROJECT_V5_KEYS;

const SETTINGS_KEYS = ['width', 'height', 'fps'] as const;
const MEDIA_KEYS = ['id', 'kind', 'sourcePath', 'fileName'] as const;
const SCENE_V3_KEYS = ['mediaId', 'durationMs'] as const;
const SCENE_V4_KEYS = [...SCENE_V3_KEYS, 'subtitle'] as const;
const SCENE_V6_KEYS = [
  ...SCENE_V4_KEYS,
  'subtitlePosition',
  'subtitleSize',
] as const;
const NARRATION_KEYS = ['sourcePath', 'fileName'] as const;

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
  const isV5 = value.schemaVersion === 5;
  const isV6 = value.schemaVersion === 6;
  const projectKeys = isV1
    ? PROJECT_V1_KEYS
    : isV2
      ? PROJECT_V2_KEYS
      : isV3
        ? PROJECT_V3_KEYS
        : isV4
          ? PROJECT_V4_KEYS
          : isV5
            ? PROJECT_V5_KEYS
            : PROJECT_V6_KEYS;

  if (
    (!isV1 && !isV2 && !isV3 && !isV4 && !isV5 && !isV6) ||
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

  if (isV2 || isV3 || isV4 || isV5 || isV6) {
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

  if (isV3 || isV4 || isV5 || isV6) {
    if (!Array.isArray(value.scenes)) {
      throw new Error(INVALID_PROJECT_MESSAGE);
    }

    const mediaById = new Map(media.map((asset) => [asset.id, asset]));
    const sceneMediaIds = new Set<string>();

    scenes = value.scenes.map((scene): Scene => {
      if (
        !isRecord(scene) ||
        !hasExactKeys(
          scene,
          isV6 ? SCENE_V6_KEYS : isV4 || isV5 ? SCENE_V4_KEYS : SCENE_V3_KEYS,
        ) ||
        typeof scene.mediaId !== 'string' ||
        scene.mediaId.length === 0 ||
        (!isV6 && sceneMediaIds.has(scene.mediaId)) ||
        ((isV4 || isV5 || isV6) && typeof scene.subtitle !== 'string') ||
        (isV6 &&
          scene.subtitlePosition !== 'top' &&
          scene.subtitlePosition !== 'center' &&
          scene.subtitlePosition !== 'bottom') ||
        (isV6 &&
          scene.subtitleSize !== 'small' &&
          scene.subtitleSize !== 'medium' &&
          scene.subtitleSize !== 'large')
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
        subtitle: isV4 || isV5 || isV6 ? (scene.subtitle as string) : '',
        subtitlePosition: isV6
          ? (scene.subtitlePosition as Scene['subtitlePosition'])
          : DEFAULT_SUBTITLE_POSITION,
        subtitleSize: isV6
          ? (scene.subtitleSize as Scene['subtitleSize'])
          : DEFAULT_SUBTITLE_SIZE,
      };
    });
  } else if (isV2) {
    scenes = media.map((asset) => ({
      mediaId: asset.id,
      durationMs: asset.kind === 'image' ? 3000 : null,
      subtitle: '',
      subtitlePosition: DEFAULT_SUBTITLE_POSITION,
      subtitleSize: DEFAULT_SUBTITLE_SIZE,
    }));
  } else {
    scenes = [];
  }

  let narration: NarrationAsset | null = null;

  if ((isV5 || isV6) && value.narration !== null) {
    if (
      !isRecord(value.narration) ||
      !hasExactKeys(value.narration, NARRATION_KEYS) ||
      typeof value.narration.sourcePath !== 'string' ||
      !isAbsoluteWindowsPath(value.narration.sourcePath) ||
      !isSupportedNarrationPath(value.narration.sourcePath) ||
      typeof value.narration.fileName !== 'string' ||
      value.narration.fileName.length === 0
    ) {
      throw new Error(INVALID_PROJECT_MESSAGE);
    }

    narration = {
      sourcePath: value.narration.sourcePath,
      fileName: value.narration.fileName,
    };
  }

  return {
    schemaVersion: 6,
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
    narration,
  };
}
