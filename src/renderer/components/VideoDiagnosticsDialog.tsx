import { useEffect, useRef, useState } from 'react';

import type { DiagnosticCandidate, DiagnosticType } from '../../shared/videoDiagnostics';
import { sortDiagnosticCandidates } from '../../shared/videoDiagnostics';
import { createMediaUrl } from '../../shared/mediaProtocol';
import { useVideoDiagnostics } from '../video-diagnostics/useVideoDiagnostics';
import { VideoStabilizationPanel } from './VideoStabilizationPanel';

export interface VideoDiagnosticsDialogProps {
  exportInProgress: boolean;
  contactSheetBusy: boolean;
  onBusyChange(busy: boolean): void;
  onClose(): void;
}

const TYPE_LABELS: Record<DiagnosticType, string> = {
  'scene-change': '장면 전환 후보',
  'motion-jump': '화면 움직임 이상 후보',
  'motion-jitter': '반복 흔들림 후보',
  'rotation-change': '회전 변화 후보',
  'scale-change': '확대·축소 변화 후보',
  'frame-change': '프레임 변화 후보',
  'brightness-change': '밝기 변화 후보',
};

const SEVERITY_LABELS = { info: '정보', low: '낮음', medium: '보통', high: '높음' } as const;

function formatTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function streamLabel(value: boolean | null, kind: 'video' | 'audio'): string {
  if (value === null) return '확인할 수 없음';
  if (kind === 'video') return value ? '영상 있음' : '영상 없음';
  return value ? '오디오 있음' : '오디오 없음';
}

function progressText(progress: ReturnType<typeof useVideoDiagnostics>['progress']): string {
  if (!progress) return '진단 준비 중';
  const stage = {
    probing: '영상 정보 확인',
    'frame-analysis': '장면·프레임 분석',
    'motion-analysis': '전역 움직임 분석',
    finalizing: '결과 정리',
    complete: '진단 완료',
  }[progress.stage];
  const time = progress.analyzedMs === null ? '' : ` · ${formatTime(progress.analyzedMs)} 분석`;
  const percent = progress.percent === null ? '' : ` · 예상 ${progress.percent.toFixed(0)}%`;
  return `${stage}${time}${percent}`;
}

export function VideoDiagnosticsDialog({
  exportInProgress,
  contactSheetBusy,
  onBusyChange,
  onClose,
}: VideoDiagnosticsDialogProps) {
  const workflow = useVideoDiagnostics(onBusyChange);
  const [stabilizationCandidate, setStabilizationCandidate] =
    useState<DiagnosticCandidate | null>(null);
  const [stabilizationBusy, setStabilizationBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const metadata = workflow.selected?.metadata;
  const candidates = workflow.result
    ? sortDiagnosticCandidates(workflow.result.candidates)
    : [];
  const blockedByOtherWork = exportInProgress || contactSheetBusy;

  useEffect(() => {
    setStabilizationCandidate(null);
  }, [workflow.selected?.sourcePath, workflow.result]);

  const handleStabilizationBusy = (busy: boolean): void => {
    setStabilizationBusy(busy);
    onBusyChange(busy);
  };

  const seekTo = (candidate: DiagnosticCandidate): void => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const requested = candidate.peakMs / 1000;
    const duration = Number.isFinite(video.duration) && video.duration >= 0
      ? video.duration
      : requested;
    video.currentTime = Math.max(0, Math.min(requested, duration));
    previewRef.current?.focus();
    previewRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

  return <div className="video-diagnostics-backdrop">
    <section className="video-diagnostics-dialog" role="dialog" aria-modal="true" aria-labelledby="video-diagnostics-heading">
      <header className="video-diagnostics-header">
        <div>
          <h2 id="video-diagnostics-heading">영상 최종 보정 진단</h2>
          <p>원본은 변경하지 않고 문제 구간 후보만 분석합니다.</p>
        </div>
        <button type="button" disabled={workflow.analyzing || stabilizationBusy} onClick={onClose}>닫기</button>
      </header>

      <div className="video-diagnostics-toolbar">
        <button type="button" disabled={workflow.analyzing || stabilizationBusy} onClick={() => void workflow.selectVideo()}>MP4 선택</button>
        <button type="button" disabled={!workflow.selected || workflow.selected.probeStatus === 'failed' || workflow.analyzing || stabilizationBusy || blockedByOtherWork} onClick={() => void workflow.analyze()}>진단 시작</button>
        {workflow.analyzing ? <button type="button" onClick={() => void workflow.cancel()}>진단 취소</button> : null}
      </div>
      {blockedByOtherWork ? <p className="video-diagnostics-notice">내보내기 또는 연속이미지 영상 생성 중에는 진단을 시작할 수 없습니다.</p> : null}

      {workflow.selected ? <div className="video-diagnostics-content">
        <div className="video-diagnostics-preview" ref={previewRef} tabIndex={-1}>
          <video ref={videoRef} aria-label="선택한 영상 미리보기" controls preload="metadata" src={createMediaUrl(workflow.selected.sourcePath)} />
          <dl className="video-diagnostics-metadata">
            <div><dt>파일명</dt><dd>{workflow.selected.fileName}</dd></div>
            <div><dt>해상도</dt><dd>{metadata?.width && metadata.height ? `${metadata.width} × ${metadata.height}` : '확인할 수 없음'}</dd></div>
            <div><dt>프레임률</dt><dd>{metadata?.fps ? `${metadata.fps} FPS` : '확인할 수 없음'}</dd></div>
            <div><dt>재생시간</dt><dd>{metadata?.durationMs ? formatTime(metadata.durationMs) : '확인할 수 없음'}</dd></div>
            <div><dt>영상 스트림</dt><dd>{streamLabel(metadata?.hasVideo ?? null, 'video')}</dd></div>
            <div><dt>오디오 스트림</dt><dd>{streamLabel(metadata?.hasAudio ?? null, 'audio')}</dd></div>
          </dl>
        </div>

        <div className="video-diagnostics-results">
          {workflow.analyzing ? <div className="video-diagnostics-progress" role="status">
            <p>{progressText(workflow.progress)}</p>
            {workflow.progress?.percent !== null && workflow.progress?.percent !== undefined
              ? <progress max="100" value={workflow.progress.percent} /> : null}
          </div> : null}
          {workflow.error ? <p className="video-diagnostics-error" role="alert">{workflow.error}</p> : null}
          {workflow.result ? <>
            <p className="video-diagnostics-disclaimer">진단 점수와 심각도는 검증된 정확도나 발생 확률이 아닙니다. 자동 분석 기준 대비 변화량이며 실제 장면을 직접 확인해야 합니다.</p>
            {workflow.result.uncertainties.map((uncertainty, index) => <p className="video-diagnostics-uncertainty" key={`${uncertainty.code}-${index}`}>{uncertainty.message}</p>)}
            {workflow.result.notices.map((notice) => <p className="video-diagnostics-notice" key={notice}>{notice}</p>)}
            <div className="video-diagnostics-result-list" role="region" aria-label="진단 결과 목록">
              {candidates.length === 0 ? <p>현재 진단 기준에서 이상 후보를 찾지 못했습니다.</p> : candidates.map((candidate, index) => <button
                className={`video-diagnostics-result severity-${candidate.severity}`}
                key={`${candidate.type}-${candidate.peakMs}-${index}`}
                type="button"
                aria-pressed={stabilizationCandidate === candidate}
                aria-label={`${TYPE_LABELS[candidate.type]} ${formatTime(candidate.peakMs)}`}
                onClick={() => {
                  seekTo(candidate);
                  setStabilizationCandidate(candidate);
                }}
              >
                <span>{formatTime(candidate.startMs)}{candidate.endMs > candidate.startMs ? `–${formatTime(candidate.endMs)}` : ''}</span>
                <strong>{TYPE_LABELS[candidate.type]}</strong>
                <span>{SEVERITY_LABELS[candidate.severity]}</span>
                <small>{candidate.scoreLabel}</small>
              </button>)}
            </div>
            {stabilizationCandidate && workflow.selected ? <VideoStabilizationPanel
              selected={workflow.selected}
              candidate={stabilizationCandidate}
              blocked={blockedByOtherWork || workflow.analyzing}
              onBusyChange={handleStabilizationBusy}
            /> : null}
          </> : null}
        </div>
      </div> : <p className="video-diagnostics-empty">진단할 완성 MP4 파일을 선택하세요.</p>}
    </section>
  </div>;
}
