import { useState } from 'react';

import {
  type ContactSheetFps,
  type ContactSheetInterpolation,
  type ContactSheetSource,
  type ContactSheetVideoProgress,
} from '../../shared/contactSheetVideo';

export interface ContactSheetListItem extends ContactSheetSource {
  analysisStatus: 'analyzing' | 'recognized' | 'failed';
  analysisMessage?: string;
}

export type ContactSheetVideoStatus =
  | 'idle'
  | 'creating'
  | 'success'
  | 'error';

export function useContactSheetVideo(
  onBusyChange: (busy: boolean) => void,
) {
  const [sheets, setSheets] = useState<ContactSheetListItem[]>([]);
  const [fps, setFps] = useState<ContactSheetFps>(8);
  const [interpolationEnabled, setInterpolationEnabled] = useState(false);
  const [interpolation, setInterpolation] =
    useState<ContactSheetInterpolation>('medium');
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<ContactSheetVideoStatus>('idle');
  const [progress, setProgress] = useState<ContactSheetVideoProgress | null>(
    null,
  );
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const addSheets = async (): Promise<void> => {
    if (adding || status === 'creating') {
      return;
    }
    setAdding(true);
    try {
      const selected = await window.combarkDesktop.openContactSheetImages();
      if (selected.length === 0) {
        return;
      }
      const selectedIds = new Set(selected.map(({ id }) => id));
      setSheets((current) => [
        ...current,
        ...selected.map((sheet) => ({
          ...sheet,
          analysisStatus: 'analyzing' as const,
        })),
      ]);
      try {
        const results = await window.combarkDesktop.analyzeContactSheets(
          selected,
        );
        const resultById = new Map(results.map((result) => [result.id, result]));
        setSheets((current) => current.map((sheet) => {
          if (!selectedIds.has(sheet.id)) {
            return sheet;
          }
          const result = resultById.get(sheet.id);
          return result?.status === 'recognized'
            ? { ...sheet, analysisStatus: 'recognized' }
            : {
                ...sheet,
                analysisStatus: 'failed',
                analysisMessage:
                  result?.status === 'failed'
                    ? result.message
                    : '분석 결과를 받지 못했습니다.',
              };
        }));
      } catch {
        setSheets((current) => current.map((sheet) =>
          selectedIds.has(sheet.id)
            ? {
                ...sheet,
                analysisStatus: 'failed',
                analysisMessage: '이미지를 분석하지 못했습니다.',
              }
            : sheet,
        ));
      }
    } finally {
      setAdding(false);
    }
  };

  const moveSheet = (index: number, direction: 'up' | 'down'): void => {
    setSheets((current) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || index >= current.length || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeSheet = (id: string): void => {
    setSheets((current) => current.filter((sheet) => sheet.id !== id));
  };

  const createVideo = async (): Promise<void> => {
    if (
      status === 'creating' ||
      sheets.length === 0 ||
      sheets.some(({ analysisStatus }) => analysisStatus !== 'recognized')
    ) {
      return;
    }
    setStatus('creating');
    setProgress({ stage: 'analyzing', sheetIndex: 1, sheetCount: sheets.length });
    setOutputPath(null);
    onBusyChange(true);
    const stopListening = window.combarkDesktop.onContactSheetVideoProgress(
      setProgress,
    );
    try {
      const result = await window.combarkDesktop.createContactSheetVideo({
        sheets: sheets.map(({ id, sourcePath, fileName }) => ({
          id,
          sourcePath,
          fileName,
        })),
        fps,
        ...(interpolationEnabled ? { interpolation } : {}),
      });
      if (result.status === 'success') {
        setStatus('success');
        setProgress({ stage: 'complete' });
        setOutputPath(result.filePath);
      } else {
        setStatus('idle');
        setProgress(null);
      }
    } catch {
      setStatus('error');
      setProgress(null);
    } finally {
      stopListening();
      onBusyChange(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (status !== 'creating') {
      return;
    }
    try {
      await window.combarkDesktop.cancelContactSheetVideo();
    } catch {
      // The create request owns the final error state.
    }
  };

  return {
    sheets,
    fps,
    interpolationEnabled,
    interpolation,
    adding,
    status,
    progress,
    outputPath,
    setFps,
    setInterpolationEnabled,
    setInterpolation,
    addSheets,
    moveSheet,
    removeSheet,
    createVideo,
    cancel,
  };
}
