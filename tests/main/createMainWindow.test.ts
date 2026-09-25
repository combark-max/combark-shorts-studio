import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const {
  MockBrowserWindow,
  browserWindowInstances,
  ipcListeners,
  removeIpcListener,
} = vi.hoisted(() => {
  const browserWindowInstances: unknown[] = [];

  class MockBrowserWindow {
    listeners = new Map<string, Listener[]>();
    close = vi.fn(() => {
      this.emit('close', { preventDefault: vi.fn() });
    });
    show = vi.fn();
    loadURL = vi.fn().mockResolvedValue(undefined);
    webContents = {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };

    constructor() {
      browserWindowInstances.push(this);
    }

    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    once(event: string, listener: Listener): this {
      return this.on(event, listener);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  return {
    MockBrowserWindow,
    browserWindowInstances,
    ipcListeners: new Map<string, (...args: unknown[]) => void>(),
    removeIpcListener: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  ipcMain: {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, listener);
    }),
    removeListener: removeIpcListener,
  },
}));

vi.stubGlobal('MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY', 'preload.js');
vi.stubGlobal('MAIN_WINDOW_WEBPACK_ENTRY', 'renderer.html');

import { createMainWindow } from '../../src/main/createMainWindow';
import { IPC_CHANNELS } from '../../src/shared/ipc';

describe('createMainWindow close protection', () => {
  beforeEach(() => {
    browserWindowInstances.length = 0;
    ipcListeners.clear();
    vi.clearAllMocks();
  });

  it('prevents the first close and sends only one request while pending', () => {
    const window = createMainWindow() as unknown as InstanceType<
      typeof MockBrowserWindow
    >;
    const firstEvent = { preventDefault: vi.fn() };
    const duplicateEvent = { preventDefault: vi.fn() };

    window.emit('close', firstEvent);
    window.emit('close', duplicateEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseRequested,
    );
  });

  it('keeps the window open on deny and permits a later close request', () => {
    const window = createMainWindow() as unknown as InstanceType<
      typeof MockBrowserWindow
    >;
    const response = ipcListeners.get(IPC_CHANNELS.windowCloseResponse);

    window.emit('close', { preventDefault: vi.fn() });
    response?.({ sender: window.webContents }, false);
    window.emit('close', { preventDefault: vi.fn() });

    expect(window.webContents.send).toHaveBeenCalledTimes(2);
    expect(window.close).not.toHaveBeenCalled();
  });

  it('accepts only the owning sender and lets the second close pass', () => {
    const window = createMainWindow() as unknown as InstanceType<
      typeof MockBrowserWindow
    >;
    const response = ipcListeners.get(IPC_CHANNELS.windowCloseResponse);
    const firstEvent = { preventDefault: vi.fn() };

    window.emit('close', firstEvent);
    response?.({ sender: {} }, true);
    expect(window.close).not.toHaveBeenCalled();

    response?.({ sender: window.webContents }, 'true');
    expect(window.close).not.toHaveBeenCalled();

    window.emit('close', { preventDefault: vi.fn() });

    response?.({ sender: window.webContents }, true);

    expect(window.close).toHaveBeenCalledOnce();
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('removes its close-response listener after the window closes', () => {
    const window = createMainWindow() as unknown as InstanceType<
      typeof MockBrowserWindow
    >;
    const response = ipcListeners.get(IPC_CHANNELS.windowCloseResponse);

    window.emit('closed');

    expect(removeIpcListener).toHaveBeenCalledWith(
      IPC_CHANNELS.windowCloseResponse,
      response,
    );
  });
});
