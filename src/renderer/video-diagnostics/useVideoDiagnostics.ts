import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  SelectedDiagnosticVideo,
  VideoDiagnosticProgress,
  VideoDiagnosticResult,
} from '../../shared/videoDiagnostics';

export type VideoDiagnosticsStatus =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'analyzing'
  | 'success'
  | 'error';

export function useVideoDiagnostics(onBusyChange: (busy: boolean) => void) {
  const [selected, setSelected] = useState<SelectedDiagnosticVideo | null>(null);
  const [status, setStatus] = useState<VideoDiagnosticsStatus>('idle');
  const [progress, setProgress] = useState<VideoDiagnosticProgress | null>(null);
  const [result, setResult] = useState<VideoDiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyzingRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (analyzingRef.current) {
        cancelRequestedRef.current = true;
        void window.combarkDesktop.cancelVideoDiagnostics();
      }
    };
  }, []);

  const selectVideo = useCallback(async () => {
    setStatus('selecting');
    setError(null);
    try {
      const selection = await window.combarkDesktop.selectDiagnosticVideo();
      if (!selection) {
        setStatus(selected ? 'ready' : 'idle');
        return;
      }
      setSelected(selection);
      setResult(null);
      setProgress(null);
      setError(selection.probeStatus === 'failed'
        ? selection.probeMessage ?? '영상 정보를 확인하지 못했습니다.'
        : null);
      setStatus(selection.probeStatus === 'failed' ? 'error' : 'ready');
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : '영상 파일을 선택하지 못했습니다.');
      setStatus(selected ? 'ready' : 'error');
    }
  }, [selected]);

  const analyze = useCallback(async () => {
    if (!selected || selected.probeStatus === 'failed' || analyzingRef.current) return;
    analyzingRef.current = true;
    cancelRequestedRef.current = false;
    onBusyChange(true);
    setStatus('analyzing');
    setResult(null);
    setError(null);
    setProgress({ stage: 'probing', analyzedMs: null, durationMs: selected.metadata.durationMs, percent: null });
    const removeProgress = window.combarkDesktop.onVideoDiagnosticsProgress(setProgress);
    try {
      const analysis = await window.combarkDesktop.analyzeDiagnosticVideo(selected.sourcePath);
      if (!mountedRef.current) return;
      setResult(analysis);
      setStatus('success');
    } catch (analysisError) {
      if (!mountedRef.current) return;
      if (cancelRequestedRef.current ||
        (analysisError instanceof Error && analysisError.name === 'AbortError')) {
        setStatus('ready');
      } else {
        setError(analysisError instanceof Error ? analysisError.message : '영상 진단에 실패했습니다.');
        setStatus('error');
      }
    } finally {
      removeProgress();
      analyzingRef.current = false;
      cancelRequestedRef.current = false;
      onBusyChange(false);
    }
  }, [onBusyChange, selected]);

  const cancel = useCallback(async () => {
    if (!analyzingRef.current) return;
    cancelRequestedRef.current = true;
    await window.combarkDesktop.cancelVideoDiagnostics();
  }, []);

  return {
    selected, status, progress, result, error,
    selectVideo, analyze, cancel,
    analyzing: status === 'analyzing',
  };
}
