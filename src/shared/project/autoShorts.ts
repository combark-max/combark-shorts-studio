import type { ProjectDocument, Scene } from './types';

export type AutoShortsDurationMode = 'default' | 'narration' | 'fallback';

export interface AutoShortsRuntimeMetadata {
  narrationDurationMs: number | null;
  videoDurationMsByMediaId: Readonly<
    Record<string, number | null | undefined>
  >;
}

export interface AutoShortsPlan {
  scenes: Scene[];
  subtitleUnitCount: number;
  changedSubtitleCount: number;
  changedImageDurationCount: number;
  durationMode: AutoShortsDurationMode;
  totalVideoSceneDurationMs: number | null;
  remainingMs: number | null;
}

const DEFAULT_IMAGE_DURATION_MS = 3000;

function splitSentencePunctuation(text: string): string[] {
  const units: string[] = [];
  let current = '';

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    current += character;
    const nextCharacter = text[index + 1];
    if (
      (character === '.' || character === '!' || character === '?') &&
      nextCharacter !== '.' &&
      nextCharacter !== '!' &&
      nextCharacter !== '?'
    ) {
      const unit = current.trim();
      if (unit) {
        units.push(unit);
      }
      current = '';
    }
  }

  const remainder = current.trim();
  if (remainder) {
    units.push(remainder);
  }
  return units;
}

export function splitSubtitleUnits(text: string): string[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 1) {
    return lines;
  }
  return splitSentencePunctuation(lines[0]);
}

function distributeSubtitleUnits(units: string[], sceneCount: number): string[] {
  if (sceneCount === 0) {
    return [];
  }
  if (units.length <= sceneCount) {
    return Array.from({ length: sceneCount }, (_, index) => units[index] ?? '');
  }

  const baseSize = Math.floor(units.length / sceneCount);
  const remainder = units.length % sceneCount;
  let unitIndex = 0;
  return Array.from({ length: sceneCount }, (_, sceneIndex) => {
    const groupSize = baseSize + (sceneIndex < remainder ? 1 : 0);
    const subtitle = units.slice(unitIndex, unitIndex + groupSize).join('\n');
    unitIndex += groupSize;
    return subtitle;
  });
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function buildAutoShortsPlan(
  project: ProjectDocument,
  text: string,
  metadata: AutoShortsRuntimeMetadata,
): AutoShortsPlan {
  const units = splitSubtitleUnits(text);
  const subtitles = distributeSubtitleUnits(units, project.scenes.length);
  const mediaById = new Map(project.media.map((asset) => [asset.id, asset]));
  const imageSceneIndexes = project.scenes.flatMap((scene, index) =>
    mediaById.get(scene.mediaId)?.kind === 'image' ? [index] : [],
  );
  const videoScenes = project.scenes.filter(
    (scene) => mediaById.get(scene.mediaId)?.kind === 'video',
  );

  let durationMode: AutoShortsDurationMode = project.narration
    ? 'fallback'
    : 'default';
  let totalVideoSceneDurationMs: number | null = null;
  let remainingMs: number | null = null;
  let imageDurations: number[] = imageSceneIndexes.map(
    () => DEFAULT_IMAGE_DURATION_MS,
  );

  if (project.narration) {
    const videoDurations = videoScenes.map(
      (scene) => metadata.videoDurationMsByMediaId[scene.mediaId],
    );
    const videoMetadataReady = videoDurations.every(isPositiveInteger);
    if (videoMetadataReady) {
      totalVideoSceneDurationMs = (videoDurations as number[]).reduce(
        (total, durationMs) => total + durationMs,
        0,
      );
    }

    if (
      imageSceneIndexes.length > 0 &&
      isPositiveInteger(metadata.narrationDurationMs) &&
      totalVideoSceneDurationMs !== null
    ) {
      remainingMs = metadata.narrationDurationMs - totalVideoSceneDurationMs;
      if (remainingMs >= imageSceneIndexes.length) {
        const baseDuration = Math.floor(remainingMs / imageSceneIndexes.length);
        const remainder = remainingMs % imageSceneIndexes.length;
        imageDurations = imageSceneIndexes.map(
          (_index, imageIndex) => baseDuration + (imageIndex < remainder ? 1 : 0),
        );
        durationMode = 'narration';
      }
    }
  }

  let imageIndex = 0;
  const scenes = project.scenes.map((scene, sceneIndex) => {
    const asset = mediaById.get(scene.mediaId);
    const durationMs =
      asset?.kind === 'image' ? imageDurations[imageIndex++] : null;
    return {
      ...scene,
      subtitle: subtitles[sceneIndex],
      durationMs,
    };
  });

  return {
    scenes,
    subtitleUnitCount: units.length,
    changedSubtitleCount: scenes.filter(
      (scene, index) => scene.subtitle !== project.scenes[index].subtitle,
    ).length,
    changedImageDurationCount: scenes.filter(
      (scene, index) =>
        mediaById.get(scene.mediaId)?.kind === 'image' &&
        scene.durationMs !== project.scenes[index].durationMs,
    ).length,
    durationMode,
    totalVideoSceneDurationMs,
    remainingMs,
  };
}
