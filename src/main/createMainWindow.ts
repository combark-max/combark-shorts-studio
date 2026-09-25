import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

import { APP_NAME } from '../shared/appInfo';
import { IPC_CHANNELS } from '../shared/ipc';

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#111318',
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let closeRequestPending = false;
  let allowClose = false;

  const handleCloseResponse = (event: IpcMainEvent, allow: boolean): void => {
    if (event.sender !== window.webContents || !closeRequestPending) {
      return;
    }

    closeRequestPending = false;
    if (allow !== true) {
      return;
    }

    allowClose = true;
    window.close();
  };

  ipcMain.on(IPC_CHANNELS.windowCloseResponse, handleCloseResponse);

  window.on('close', (event) => {
    if (allowClose) {
      return;
    }

    event.preventDefault();
    if (closeRequestPending) {
      return;
    }

    closeRequestPending = true;
    window.webContents.send(IPC_CHANNELS.windowCloseRequested);
  });

  window.on('closed', () => {
    ipcMain.removeListener(
      IPC_CHANNELS.windowCloseResponse,
      handleCloseResponse,
    );
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== MAIN_WINDOW_WEBPACK_ENTRY) {
      event.preventDefault();
    }
  });

  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  return window;
}
