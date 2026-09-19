import { app, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';

export function registerAppIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.appGetVersion);
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion());
}