import { useRef, useState } from 'react';

import {
  type ContactSheetFps,
  type ContactSheetOutputFps,
  type ContactSheetCropMode,
  type ContactSheetDetails,
  type ContactSheetInterpolation,
  type ContactSheetSource,
  type ContactSheetVideoProgress,
  type ContactSheetFrameRect,
} from '../../shared/contactSheetVideo';

export interface ContactSheetListItem extends ContactSheetSource {
  analysisStatus: 'analyzing' | 'recognized' | 'failed';
  analysisMessage?: string;
  details?: ContactSheetDetails;
  rows: number;
  columns: number;
  frameCount: number;
  previewWidth?: number;
  previewHeight?: number;
  frames?: ContactSheetFrameRect[];
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
  const [smoothEnabled, setSmoothEnabledState] = useState(false);
  const [outputFps, setOutputFps] = useState<ContactSheetOutputFps>(24);
  const [cropMode, setCropMode] = useState<ContactSheetCropMode>('top-left');
  const setSlowMotionEnabled = (enabled: boolean): void => {
    setInterpolationEnabled(enabled);
    if (enabled) setSmoothEnabledState(false);
  };
  const setSmoothEnabled = (enabled: boolean): void => {
    setSmoothEnabledState(enabled);
    if (enabled) setInterpolationEnabled(false);
  };
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<ContactSheetVideoStatus>('idle');
  const [progress, setProgress] = useState<ContactSheetVideoProgress | null>(
    null,
  );
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const analysisVersionRef = useRef(new Map<string, number>());

  const applyResult = (
    sheet: ContactSheetListItem,
    result: Awaited<ReturnType<typeof window.combarkDesktop.analyzeContactSheets>>[number] | undefined,
  ): ContactSheetListItem => result?.status === 'recognized'
    ? {
        ...sheet,
        analysisStatus: 'recognized',
        frameCount: result.frameCount,
        details: result.details,
        previewWidth: result.width,
        previewHeight: result.height,
        frames: result.frames,
        analysisMessage: undefined,
      }
    : {
        ...sheet,
        analysisStatus: 'failed',
        frames: undefined,
        analysisMessage: result?.status === 'failed'
          ? result.message
          : '분석 결과를 받지 못했습니다.',
      };

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
      const selectedVersions = new Map(selected.map(({ id }) => {
        const version = (analysisVersionRef.current.get(id) ?? 0) + 1;
        analysisVersionRef.current.set(id, version);
        return [id, version];
      }));
      setSheets((current) => [
        ...current,
        ...selected.map((sheet) => ({
          ...sheet,
          rows: 4,
          columns: 4,
          frameCount: 16,
          analysisStatus: 'analyzing' as const,
        })),
      ]);
      try {
        const results = await window.combarkDesktop.analyzeContactSheets(
          selected.map((sheet) => ({ ...sheet, rows: 4, columns: 4 })),
        );
        const resultById = new Map(results.map((result) => [result.id, result]));
        setSheets((current) => current.map((sheet) => {
          if (!selectedIds.has(sheet.id)) {
            return sheet;
          }
          if (
            analysisVersionRef.current.get(sheet.id) !== selectedVersions.get(sheet.id) ||
            sheet.rows !== 4 || sheet.columns !== 4
          ) {
            return sheet;
          }
          const result = resultById.get(sheet.id);
          return applyResult(sheet, result);
        }));
      } catch {
        setSheets((current) => current.map((sheet) =>
          selectedIds.has(sheet.id) &&
          analysisVersionRef.current.get(sheet.id) === selectedVersions.get(sheet.id)
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

  const updateGrid = (id: string, field: 'rows' | 'columns', value: number): void => {
    if (!Number.isSafeInteger(value) || value < 1 || value > 12 || status === 'creating') return;
    const current = sheets.find((sheet) => sheet.id === id);
    if (!current || current[field] === value) return;
    const next = { ...current, [field]: value };
    if (next.rows * next.columns > 144) return;
    const version = (analysisVersionRef.current.get(id) ?? 0) + 1;
    analysisVersionRef.current.set(id, version);
    setSheets((items) => items.map((sheet) => sheet.id === id ? {
      ...sheet,
      [field]: value,
      frameCount: next.rows * next.columns,
      analysisStatus: 'analyzing',
      analysisMessage: undefined,
      details: undefined,
      frames: undefined,
      previewWidth: undefined,
      previewHeight: undefined,
    } : sheet));
    void window.combarkDesktop.analyzeContactSheets([{
      id: next.id, sourcePath: next.sourcePath, fileName: next.fileName,
      rows: next.rows, columns: next.columns,
    }]).then((results) => {
      if (analysisVersionRef.current.get(id) !== version) return;
      setSheets((items) => items.map((sheet) =>
        sheet.id === id && sheet.rows === next.rows && sheet.columns === next.columns
          ? applyResult(sheet, results[0])
          : sheet,
      ));
    }).catch(() => {
      if (analysisVersionRef.current.get(id) !== version) return;
      setSheets((items) => items.map((sheet) => sheet.id === id ? {
        ...sheet, analysisStatus: 'failed', analysisMessage: '이미지를 분석하지 못했습니다.',
      } : sheet));
    });
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
    analysisVersionRef.current.set(id, (analysisVersionRef.current.get(id) ?? 0) + 1);
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
        sheets: sheets.map(({ id, sourcePath, fileName, rows, columns }) => ({
          id,
          sourcePath,
          fileName,
          rows,
          columns,
        })),
        fps,
        ...(smoothEnabled ? { outputFps } : interpolationEnabled ? { interpolation } : {}),
        ...(cropMode === 'center' ? { cropMode } : {}),
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
    setInterpolationEnabled: setSlowMotionEnabled,
    smoothEnabled,
    outputFps,
    cropMode,
    setSmoothEnabled,
    setOutputFps,
    setCropMode,
    setInterpolation,
    addSheets,
    moveSheet,
    removeSheet,
    updateGrid,
    createVideo,
    cancel,
  };
}
