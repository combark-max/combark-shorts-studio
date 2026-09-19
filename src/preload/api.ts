import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';

export const desktopApi = {
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
};

export type DesktopApi = typeof desktopApi;