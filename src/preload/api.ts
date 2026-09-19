export const desktopApi = {
  platform: 'win32',
} as const;

export type DesktopApi = typeof desktopApi;