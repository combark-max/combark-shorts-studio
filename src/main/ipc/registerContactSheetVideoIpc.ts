import { randomUUID } from 'node:crypto';
import { basename, win32 } from 'node:path';

import { app, dialog, ipcMain } from 'electron';

import type {
  ContactSheetAnalysisResult,
  ContactSheetSource,
  ContactSheetVideoProgress,
  CreateContactSheetVideoRequest,
  CreateContactSheetVideoResult,
} from '../../shared/contactSheetVideo';
import {
  CONTACT_SHEET_FPS_VALUES,
  CONTACT_SHEET_INTERPOLATION_VALUES,
} from '../../shared/contactSheetVideo';
import { IPC_CHANNELS } from '../../shared/ipc';
import { analyzeContactSheet } from '../contact-sheet/analyzeContactSheet';
import { createContactSheetVideo } from '../contact-sheet/createContactSheetVideo';
import { getRuntimeFfmpegPath } from '../export/exportProject';

const contactSheetFilter = {
  name: 'Contact sheet 이미지',
  extensions: ['jpg', 'jpeg', 'png'],
};
const supportedContactSheetPath = /\.(?:jpe?g|png)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContactSheetSource(value: unknown): value is ContactSheetSource {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.sourcePath === 'string' &&
    win32.isAbsolute(value.sourcePath) &&
    supportedContactSheetPath.test(value.sourcePath) &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0
  );
}

function validateSheets(
  value: unknown,
  allowEmpty: boolean,
): asserts value is ContactSheetSource[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((sheet) => !isContactSheetSource(sheet)) ||
    new Set(value.map((sheet) => sheet.id)).size !== value.length
  ) {
    throw new Error('유효하지 않은 contact sheet 요청입니다.');
  }
}

function validateCreateRequest(
  value: unknown,
): asserts value is CreateContactSheetVideoRequest {
  if (!isRecord(value)) {
    throw new Error('유효하지 않은 contact sheet 영상 생성 요청입니다.');
  }
  validateSheets(value.sheets, false);
  if (
    typeof value.fps !== 'number' ||
    !CONTACT_SHEET_FPS_VALUES.some((fps) => fps === value.fps) ||
    (
      value.interpolation !== undefined &&
      (
        typeof value.interpolation !== 'string' ||
        !CONTACT_SHEET_INTERPOLATION_VALUES.some(
          (interpolation) => interpolation === value.interpolation,
        )
      )
    )
  ) {
    throw new Error('유효하지 않은 contact sheet 영상 생성 요청입니다.');
  }
}

function ensureMp4Extension(filePath: string): string {
  return filePath.toLocaleLowerCase('en-US').endsWith('.mp4')
    ? filePath
    : `${filePath}.mp4`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : '4×4 contact sheet를 분석하지 못했습니다.';
}

export function registerContactSheetVideoIpc(): void {
  let activeJob: {
    sender: Electron.WebContents;
    controller: AbortController;
  } | null = null;

  ipcMain.removeHandler(IPC_CHANNELS.contactSheetVideoOpen);
  ipcMain.handle(IPC_CHANNELS.contactSheetVideoOpen, async (): Promise<ContactSheetSource[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [contactSheetFilter],
    });
    if (result.canceled) {
      return [];
    }
    return result.filePaths.map((sourcePath) => ({
      id: randomUUID(),
      sourcePath,
      fileName: basename(sourcePath),
    }));
  });

  ipcMain.removeHandler(IPC_CHANNELS.contactSheetVideoAnalyze);
  ipcMain.handle(
    IPC_CHANNELS.contactSheetVideoAnalyze,
    async (_event, sheets: unknown): Promise<ContactSheetAnalysisResult[]> => {
      validateSheets(sheets, true);
      return sheets.map((sheet): ContactSheetAnalysisResult => {
        try {
          const analysis = analyzeContactSheet(sheet.sourcePath);
          if (analysis.frames.length !== 16) {
            throw new Error('16개 프레임을 인식하지 못했습니다.');
          }
          return { id: sheet.id, status: 'recognized', frameCount: 16 };
        } catch (error) {
          return { id: sheet.id, status: 'failed', message: errorMessage(error) };
        }
      });
    },
  );

  ipcMain.removeHandler(IPC_CHANNELS.contactSheetVideoCancel);
  ipcMain.handle(IPC_CHANNELS.contactSheetVideoCancel, (event) => {
    if (activeJob?.sender === event.sender) {
      activeJob.controller.abort();
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.contactSheetVideoCreate);
  ipcMain.handle(
    IPC_CHANNELS.contactSheetVideoCreate,
    async (
      event,
      request: unknown,
    ): Promise<CreateContactSheetVideoResult> => {
      validateCreateRequest(request);
      if (activeJob) {
        throw new Error('연속 프레임 영상 만들기가 이미 진행 중입니다.');
      }

      const controller = new AbortController();
      const handleDestroyed = (): void => controller.abort();
      activeJob = { sender: event.sender, controller };
      event.sender.once('destroyed', handleDestroyed);
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: '연속 프레임 영상.mp4',
          filters: [{ name: 'MP4 비디오', extensions: ['mp4'] }],
        });
        if (result.canceled || !result.filePath) {
          return { status: 'canceled' };
        }
        const filePath = ensureMp4Extension(result.filePath);
        try {
          await createContactSheetVideo(
            request,
            filePath,
            {
              ffmpegPath: getRuntimeFfmpegPath(
                app.isPackaged,
                process.resourcesPath,
              ),
              onProgress: (progress: ContactSheetVideoProgress) => {
                if (!event.sender.isDestroyed()) {
                  event.sender.send(
                    IPC_CHANNELS.contactSheetVideoProgress,
                    progress,
                  );
                }
              },
            },
            controller.signal,
          );
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return { status: 'canceled' };
          }
          throw error;
        }
        return { status: 'success', filePath };
      } finally {
        event.sender.removeListener('destroyed', handleDestroyed);
        activeJob = null;
      }
    },
  );
}
