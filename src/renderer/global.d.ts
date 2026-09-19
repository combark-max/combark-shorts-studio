import type { DesktopApi } from '../preload/api';

declare global {
  interface Window {
    combarkDesktop: DesktopApi;
  }
}

export {};