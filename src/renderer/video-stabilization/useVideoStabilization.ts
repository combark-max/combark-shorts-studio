import { useCallback, useEffect, useRef, useState } from 'react';

import {
  diagnosticCandidateKey,
  type DiagnosticCandidate,
  type SelectedDiagnosticVideo,
} from '../../shared/videoDiagnostics';
import type {
  StabilizationEncoder,
  StabilizationPreviewProgress,
  StabilizationPreviewResult,
  StabilizationSelectionMode,
  StabilizationStrength,
  StabilizationZoomPercent,
} from '../../shared/videoStabilization';

export type VideoStabilizationStatus = 'idle' | 'ready' | 'running' | 'success' | 'error';

function initialRange(
  selected: SelectedDiagnosticVideo | null,
  candidate: DiagnosticCandidate | null,
): { start: number; end: number } {
  if (!selected || !candidate) return { start: 0, end: 5_000 };
  const duration = selected.metadata.durationMs ?? candidate.peakMs + 2_500;
  const start = Math.max(0, Math.min(candidate.peakMs - 2_500, duration - 5_000));
  return { start, end: Math.min(duration, start + 5_000) };
}

export function useVideoStabilization(
  selected: SelectedDiagnosticVideo | null,
  candidate: DiagnosticCandidate | null,
  onBusyChange: (busy: boolean) => void,
) {
  const range = initialRange(selected, candidate);
  const [status, setStatus] = useState<VideoStabilizationStatus>(candidate ? 'ready' : 'idle');
  const [strength, setStrength] = useState<StabilizationStrength>('weak');
  const [zoomPercent, setZoomPercent] = useState<StabilizationZoomPercent>(2);
  const [encoder, setEncoder] = useState<StabilizationEncoder>('libx264');
  const [selectionMode, setSelectionMode] = useState<StabilizationSelectionMode>('range');
  const [requestedStartMs, setRequestedStartMs] = useState(range.start);
  const [requestedEndMs, setRequestedEndMs] = useState(range.end);
  const [sceneBoundaryConfirmed, setSceneBoundaryConfirmed] = useState(false);
  const [scaleMotionConfirmed, setScaleMotionConfirmed] = useState(false);
  const [progress, setProgress] = useState<StabilizationPreviewProgress | null>(null);
  const [result, setResult] = useState<StabilizationPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const resultRef = useRef<StabilizationPreviewResult | null>(null);
  const candidateKey = candidate ? diagnosticCandidateKey(candidate) : null;
  const selectionIdentity = selected && candidateKey
    ? `${selected.sourcePath}\u0000${candidateKey}`
    : null;
  const selectionIdentityRef = useRef(selectionIdentity);

  useEffect(() => {
    if (runningRef.current) {
      cancelRequestedRef.current = true;
      void window.combarkDesktop.cancelStabilizationPreview();
    }
    selectionIdentityRef.current = selectionIdentity;
    const nextRange = initialRange(selected, candidate);
    setRequestedStartMs(nextRange.start);
    setRequestedEndMs(nextRange.end);
    setSceneBoundaryConfirmed(false);
    setScaleMotionConfirmed(false);
    setError(null);
    setProgress(null);
    setStatus(candidate ? 'ready' : 'idle');
    const stale = resultRef.current;
    resultRef.current = null;
    setResult(null);
    if (stale) void window.combarkDesktop.disposeStabilizationPreview(stale.previewId);
  }, [candidateKey, candidate, selected, selectionIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (runningRef.current) void window.combarkDesktop.cancelStabilizationPreview();
      if (resultRef.current) {
        void window.combarkDesktop.disposeStabilizationPreview(resultRef.current.previewId);
        resultRef.current = null;
      }
    };
  }, []);

  const createPreview = useCallback(async (): Promise<void> => {
    if (!selected || !candidate || !candidateKey || runningRef.current) return;
    const requestSelectionIdentity = selectionIdentity;
    runningRef.current = true;
    cancelRequestedRef.current = false;
    onBusyChange(true);
    setStatus('running');
    setError(null);
    setProgress({ stage: 'planning', percent: 0, processedFrames: null, totalFrames: null });
    const removeProgress = window.combarkDesktop.onStabilizationPreviewProgress((value) => {
      if (mountedRef.current) setProgress(value);
    });
    try {
      const preview = await window.combarkDesktop.createStabilizationPreview({
        sourcePath: selected.sourcePath,
        candidateKey,
        selectionMode,
        requestedStartMs,
        requestedEndMs,
        sceneBoundaryConfirmed,
        scaleMotionConfirmed,
        strength,
        zoomPercent,
        encoder,
        includeAudio: selected.metadata.hasAudio === true,
      });
      if (!mountedRef.current || selectionIdentityRef.current !== requestSelectionIdentity) {
        await window.combarkDesktop.disposeStabilizationPreview(preview.previewId);
        return;
      }
      if (resultRef.current) {
        await window.combarkDesktop.disposeStabilizationPreview(resultRef.current.previewId);
      }
      resultRef.current = preview;
      setResult(preview);
      setStatus('success');
    } catch (value) {
      if (!mountedRef.current) return;
      if (cancelRequestedRef.current || (value instanceof Error && value.name === 'AbortError')) {
        setStatus('ready');
        setError(null);
      } else {
        setStatus('error');
        setError(value instanceof Error ? value.message : '안정화 시험 보정에 실패했습니다.');
      }
    } finally {
      removeProgress();
      runningRef.current = false;
      cancelRequestedRef.current = false;
      onBusyChange(false);
    }
  }, [
    candidate, candidateKey, encoder, onBusyChange, requestedEndMs, requestedStartMs,
    scaleMotionConfirmed, sceneBoundaryConfirmed, selected, selectionIdentity, selectionMode,
    strength, zoomPercent,
  ]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!runningRef.current) return;
    cancelRequestedRef.current = true;
    await window.combarkDesktop.cancelStabilizationPreview();
  }, []);

  const discard = useCallback(async (): Promise<void> => {
    const current = resultRef.current;
    if (!current) return;
    resultRef.current = null;
    setResult(null);
    await window.combarkDesktop.disposeStabilizationPreview(current.previewId);
    if (mountedRef.current) setStatus(candidate ? 'ready' : 'idle');
  }, [candidate]);

  return {
    status, strength, zoomPercent, encoder, selectionMode,
    requestedStartMs, requestedEndMs, sceneBoundaryConfirmed, scaleMotionConfirmed,
    progress, result, error, busy: status === 'running',
    setStrength, setZoomPercent, setEncoder, setSelectionMode,
    setRequestedStartMs, setRequestedEndMs,
    setSceneBoundaryConfirmed, setScaleMotionConfirmed,
    createPreview, cancel, discard,
  };
}
