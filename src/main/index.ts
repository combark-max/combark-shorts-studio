import { app, BrowserWindow } from 'electron';

import { APP_ID } from '../shared/appInfo';
import { createMainWindow } from './createMainWindow';

app.setAppUserModelId(APP_ID);

void app.whenReady().then(() => {
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