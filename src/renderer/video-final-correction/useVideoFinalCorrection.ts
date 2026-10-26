import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  SelectedFinalCorrectionVideo,
  VideoFinalCorrectionMethod,
  VideoFinalCorrectionProgress,
  VideoFinalCorrectionResult,
} from '../../shared/videoFinalCorrection';

export type VideoFinalCorrectionStatus =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'running'
  | 'success'
  | 'error';

export function useVideoFinalCorrection(onBusyChange: (busy: boolean) => void) {
  const [selected, setSelected] = useState<SelectedFinalCorrectionVideo | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [method, setMethodState] = useState<VideoFinalCorrectionMethod>('basic');
  const [status, setStatus] = useState<VideoFinalCorrectionStatus>('idle');
  const [progress, setProgress] = useState<VideoFinalCorrectionProgress | null>(null);
  const [result, setResult] = useState<VideoFinalCorrectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const cancelRequestedRef = useRef(false);

  const selectVideo = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    setStatus('selecting');
    setError(null);
    onBusyChange(true);
    try {
      const value = await window.combarkDesktop.selectFinalCorrectionVideo();
      if (!value) {
        setStatus(selected ? 'ready' : 'idle');
        return;
      }
      setSelected(value);
      setOutputPath(null);
      setMethodState('basic');
      setResult(null);
      setProgress(null);
      setStatus('ready');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'MP4 파일을 선택하지 못했습니다.');
      setStatus('error');
    } finally {
      onBusyChange(false);
    }
  }, [onBusyChange, selected]);

  const selectOutput = useCallback(async (): Promise<void> => {
    if (!selected || runningRef.current) return;
    setError(null);
    try {
      const value = await window.combarkDesktop.selectFinalCorrectionOutput(selected.sourcePath);
      if (!value) return;
      setOutputPath(value);
      setResult(null);
      setStatus('ready');
    } catch (value) {
      setError(value instanceof Error ? value.message : '출력 경로를 선택하지 못했습니다.');
      setStatus('error');
    }
  }, [selected]);

  const setMethod = useCallback((value: VideoFinalCorrectionMethod): void => {
    if (runningRef.current || (value === 'strong' && !selected?.capabilities.strong)) return;
    setMethodState(value);
    if (result) setOutputPath(null);
    setResult(null);
  }, [result, selected]);

  const start = useCallback(async (): Promise<void> => {
    if (!selected || !outputPath || runningRef.current) return;
    runningRef.current = true;
    cancelRequestedRef.current = false;
    setStatus('running');
    setError(null);
    setResult(null);
    setProgress(null);
    onBusyChange(true);
    const removeProgress = window.combarkDesktop.onVideoFinalCorrectionProgress(setProgress);
    try {
      const value = await window.combarkDesktop.startVideoFinalCorrection({
        sourcePath: selected.sourcePath,
        outputPath,
        method,
      });
      setResult(value);
      setStatus('success');
    } catch (value) {
      if (cancelRequestedRef.current || (value instanceof Error && value.name === 'AbortError')) {
        setStatus('ready');
        setError(null);
      } else {
        setError(value instanceof Error ? value.message : '영상 최종 보정에 실패했습니다.');
        setStatus('error');
      }
    } finally {
      removeProgress();
      runningRef.current = false;
      cancelRequestedRef.current = false;
      onBusyChange(false);
    }
  }, [method, onBusyChange, outputPath, selected]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runningRef.current) return;
    cancelRequestedRef.current = true;
    await window.combarkDesktop.cancelVideoFinalCorrection();
  }, []);

  useEffect(() => () => {
    if (runningRef.current) void window.combarkDesktop.cancelVideoFinalCorrection();
  }, []);

  return {
    selected,
    outputPath,
    method,
    status,
    progress,
    result,
    error,
    busy: status === 'running' || status === 'selecting',
    selectVideo,
    selectOutput,
    setMethod,
    start,
    cancel,
  };
}
