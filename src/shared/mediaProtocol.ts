export const MEDIA_PROTOCOL_SCHEME = 'combark-media';

export function createMediaUrl(sourcePath: string): string {
  const url = new URL(`${MEDIA_PROTOCOL_SCHEME}://local/`);
  url.searchParams.set('path', sourcePath);
  return url.toString();
}
