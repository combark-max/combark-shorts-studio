import { app, BrowserWindow } from 'electron';

import { APP_ID } from '../shared/appInfo';
import { createMainWindow } from './createMainWindow';
import { registerAppIpc } from './ipc/registerAppIpc';
import { registerExportIpc } from './ipc/registerExportIpc';
import { registerProjectIpc } from './ipc/registerProjectIpc';
import {
  registerMediaProtocol,
  registerMediaProtocolScheme,
} from './media/registerMediaProtocol';

app.setAppUserModelId(APP_ID);
registerMediaProtocolScheme();

void app.whenReady().then(() => {
  registerMediaProtocol();
  registerAppIpc();
  registerExportIpc();
  registerProjectIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
