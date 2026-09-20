import type { MediaAsset } from './types';

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);
const narrationExtensions = new Set(['mp3', 'wav']);

function getExtension(filePath: string): string | null {
  return /\.([^.\\/]+)$/.exec(filePath)?.[1]?.toLocaleLowerCase('en-US') ?? null;
}

export function getMediaKind(filePath: string): MediaAsset['kind'] | null {
  const extension = getExtension(filePath);

  if (extension && imageExtensions.has(extension)) {
    return 'image';
  }

  return extension === 'mp4' ? 'video' : null;
}

export function isSupportedNarrationPath(filePath: string): boolean {
  const extension = getExtension(filePath);
  return extension !== null && narrationExtensions.has(extension);
}
