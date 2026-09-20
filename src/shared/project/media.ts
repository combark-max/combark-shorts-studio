import type { MediaAsset } from './types';

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function getMediaKind(filePath: string): MediaAsset['kind'] | null {
  const extension = /\.([^.\\/]+)$/.exec(filePath)?.[1]
    ?.toLocaleLowerCase('en-US');

  if (extension && imageExtensions.has(extension)) {
    return 'image';
  }

  return extension === 'mp4' ? 'video' : null;
}
