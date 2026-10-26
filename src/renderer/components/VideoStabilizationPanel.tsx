import { createMediaUrl } from '../../shared/mediaProtocol';
import type { DiagnosticCandidate, DiagnosticType, SelectedDiagnosticVideo } from '../../shared/videoDiagnostics';
import type { StabilizationPreviewManifest } from '../../shared/videoStabilization';
import { useStabilizationABPlayback } from '../video-stabilization/useStabilizationABPlayback';
import { useVideoStabilization } from '../video-stabilization/useVideoStabilization';

export interface VideoStabilizationPanelProps {
  selected: SelectedDiagnosticVideo;
  candidate: DiagnosticCandidate;
  blocked: boolean;
  onBusyChange(busy: boolean): void;
}

function ineligibleReason(candidate: DiagnosticCandidate): string | null {
  if (candidate.type === 'motion-jitter' || candidate.type === 'motion-jump') return null;
  if (candidate.type === 'rotation-change') {
    return candidate.confidence === 'high'
      ? null
      : '회전 후보의 신뢰도가 부족하여 자동 안정화할 수 없습니다.';
  }
  if (candidate.type === 'scale-change') return null;
  return '이 진단 후보는 흔들림 안정화 대상이 아닙니다.';
}

function formatSeconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(2);
}

const CANDIDATE_TYPE_LABELS: Record<DiagnosticType, string> = {
  'scene-change': '장면 전환 후보',
  'motion-jump': '화면 이동 후보',
  'motion-jitter': '반복 흔들림 후보',
  'rotation-change': '회전 변화 후보',
  'scale-change': '확대·축소 변화 후보',
  'frame-change': '프레임 변화 후보',
  'brightness-change': '밝기 변화 후보',
};

function formatTime(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor(value % 60_000 / 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.` +
    String(value % 1_000).padStart(3, '0');
}

function frameTime(frame: number, fps: number): string {
  return formatTime(frame / fps * 1_000);
}

function strengthLabel(value: StabilizationPreviewManifest['strength']): string {
  return { off: '끄기', weak: '약하게', medium: '보통' }[value];
}

function encoderLabel(value: StabilizationPreviewManifest['encoder']): string {
  return value === 'libx264' ? 'CPU (libx264)' : 'Intel QSV';
}

export function VideoStabilizationPanel({
  selected,
  candidate,
  blocked,
  onBusyChange,
}: VideoStabilizationPanelProps) {
  const workflow = useVideoStabilization(selected, candidate, onBusyChange);
  const playback = useStabilizationABPlayback(workflow.result);
  const reason = ineligibleReason(candidate);
  const duration = workflow.requestedEndMs - workflow.requestedStartMs;
  const rangeValid = duration >= 5_000 && duration <= 10_000 &&
    candidate.peakMs >= workflow.requestedStartMs && candidate.peakMs < workflow.requestedEndMs;
  const scaleConfirmed = candidate.type !== 'scale-change' || workflow.scaleMotionConfirmed;
  const canCreate = !reason && !blocked && !workflow.busy && rangeValid &&
    workflow.sceneBoundaryConfirmed && scaleConfirmed;

  return <section className="video-stabilization-panel" aria-labelledby="video-stabilization-heading">
    <header>
      <h3 id="video-stabilization-heading">선택 구간 흔들림 시험 보정</h3>
      <p>{formatSeconds(workflow.requestedStartMs)}초–{formatSeconds(workflow.requestedEndMs)}초 · 후보 {formatSeconds(candidate.peakMs)}초</p>
    </header>
    {reason ? <p className="video-stabilization-warning">{reason}</p> : <>
      <div className="video-stabilization-settings">
        <fieldset disabled={workflow.busy}>
          <legend>보정 강도</legend>
          {(['off', 'weak', 'medium'] as const).map((value) => <label key={value}>
            <input type="radio" name="stabilization-strength" checked={workflow.strength === value} onChange={() => workflow.setStrength(value)} />
            {{ off: '끄기', weak: '약하게', medium: '보통' }[value]}
          </label>)}
        </fieldset>
        <fieldset disabled={workflow.busy || workflow.strength === 'off'}>
          <legend>고정 확대</legend>
          {([1, 2, 3] as const).map((value) => <label key={value}>
            <input type="radio" name="stabilization-zoom" checked={workflow.zoomPercent === value} onChange={() => workflow.setZoomPercent(value)} />
            {value}%
          </label>)}
        </fieldset>
        <label>인코더
          <select disabled={workflow.busy} value={workflow.encoder} onChange={(event) => workflow.setEncoder(event.target.value as 'libx264' | 'h264_qsv')}>
            <option value="libx264">CPU (libx264)</option>
            <option value="h264_qsv">Intel QSV 시험</option>
          </select>
        </label>
        <label>시작(초)
          <input type="number" step="0.01" disabled={workflow.busy} value={formatSeconds(workflow.requestedStartMs)} onChange={(event) => workflow.setRequestedStartMs(Number(event.target.value) * 1_000)} />
        </label>
        <label>종료(초)
          <input type="number" step="0.01" disabled={workflow.busy} value={formatSeconds(workflow.requestedEndMs)} onChange={(event) => workflow.setRequestedEndMs(Number(event.target.value) * 1_000)} />
        </label>
      </div>
      {!rangeValid ? <p className="video-stabilization-warning">후보를 포함하는 5~10초 구간을 입력하세요.</p> : null}
      <label className="video-stabilization-confirmation">
        <input type="checkbox" disabled={workflow.busy} checked={workflow.sceneBoundaryConfirmed} onChange={(event) => workflow.setSceneBoundaryConfirmed(event.target.checked)} />
        제안된 장면 경계와 앞뒤 원본 핸들을 확인했습니다.
      </label>
      {candidate.type === 'scale-change' ? <label className="video-stabilization-confirmation">
        <input type="checkbox" disabled={workflow.busy} checked={workflow.scaleMotionConfirmed} onChange={(event) => workflow.setScaleMotionConfirmed(event.target.checked)} />
        의도적인 줌이 약해질 수 있음을 확인했습니다.
      </label> : null}
      <div className="video-stabilization-actions">
        <button type="button" disabled={!canCreate} onClick={() => void workflow.createPreview()}>5~10초 시험 보정</button>
        {workflow.busy ? <button type="button" onClick={() => void workflow.cancel()}>시험 취소</button> : null}
      </div>
      {workflow.progress ? <p role="status">{workflow.progress.stage} · {workflow.progress.percent ?? 0}%</p> : null}
      {workflow.error ? <p role="alert" className="video-stabilization-error">{workflow.error}</p> : null}
      {workflow.result ? <div className="video-stabilization-comparison">
        <div className="video-stabilization-ab-controls">
          <button type="button" disabled={!playback.ready} aria-pressed={playback.activeVersion === 'original'} onClick={() => playback.switchVersion('original')}>원본 보기</button>
          <button type="button" disabled={!playback.ready} aria-pressed={playback.activeVersion === 'corrected'} onClick={() => playback.switchVersion('corrected')}>보정본 보기</button>
          <button type="button" onClick={() => void workflow.discard()}>결과 폐기</button>
        </div>
        {!playback.ready ? <p role="status">원본과 보정본의 재생 위치를 맞추는 중입니다.</p> : null}
        {playback.message ? <p role="alert" className="video-stabilization-warning">{playback.message}</p> : null}
        <video
          key={`${workflow.result.previewId}:original`}
          ref={playback.originalRef}
          aria-label="원본 A/B 영상"
          hidden={playback.activeVersion !== 'original'}
          controls
          preload="metadata"
          src={createMediaUrl(workflow.result.manifest.sourcePath)}
          onLoadedMetadata={() => playback.onLoadedMetadata('original')}
          onTimeUpdate={() => playback.onTimeUpdate('original')}
          onPlay={() => playback.onPlay('original')}
          onPause={() => playback.onPause('original')}
          onRateChange={() => playback.onRateChange('original')}
          onEnded={() => playback.onEnded('original')}
        />
        <video
          key={`${workflow.result.previewId}:corrected`}
          ref={playback.correctedRef}
          aria-label="보정본 A/B 영상"
          hidden={playback.activeVersion !== 'corrected'}
          controls
          preload="metadata"
          src={createMediaUrl(workflow.result.previewPath)}
          muted
          onLoadedMetadata={() => playback.onLoadedMetadata('corrected')}
          onTimeUpdate={() => playback.onTimeUpdate('corrected')}
          onPlay={() => playback.onPlay('corrected')}
          onPause={() => playback.onPause('corrected')}
          onRateChange={() => playback.onRateChange('corrected')}
          onEnded={() => playback.onEnded('corrected')}
        />
        <dl className="video-stabilization-manifest">
          <div><dt>원본</dt><dd>{workflow.result.manifest.sourceFileName}<br />{workflow.result.manifest.sourcePath}</dd></div>
          <div><dt>진단 후보</dt><dd>{CANDIDATE_TYPE_LABELS[workflow.result.manifest.candidateType]} · {formatTime(workflow.result.manifest.candidatePeakMs)}<br />{workflow.result.manifest.candidateKey}</dd></div>
          <div><dt>선택·프레임률</dt><dd>{workflow.result.manifest.selectionMode === 'scene' ? '장면' : '제한 구간'} · {workflow.result.manifest.fps} fps</dd></div>
          <div><dt>시험 영상</dt><dd>{frameTime(workflow.result.manifest.previewStartFrame, workflow.result.manifest.fps)}–{frameTime(workflow.result.manifest.previewEndFrameExclusive, workflow.result.manifest.fps)}</dd></div>
          <div><dt>안정화 코어</dt><dd>{frameTime(workflow.result.manifest.correctionStartFrame, workflow.result.manifest.fps)}–{frameTime(workflow.result.manifest.correctionEndFrameExclusive, workflow.result.manifest.fps)}</dd></div>
          <div><dt>원본 핸들</dt><dd>앞 {((workflow.result.manifest.correctionStartFrame - workflow.result.manifest.previewStartFrame) / workflow.result.manifest.fps).toFixed(3)}초 · 뒤 {((workflow.result.manifest.previewEndFrameExclusive - workflow.result.manifest.correctionEndFrameExclusive) / workflow.result.manifest.fps).toFixed(3)}초</dd></div>
          <div><dt>보정 설정</dt><dd>{strengthLabel(workflow.result.manifest.strength)} · 요청 {workflow.result.manifest.requestedZoomPercent}% · 적용 {workflow.result.manifest.appliedZoomPercent}%</dd></div>
          <div><dt>인코더</dt><dd>{encoderLabel(workflow.result.manifest.encoder)}</dd></div>
        </dl>
        <p className={`video-stabilization-assessment status-${workflow.result.boundaryAssessment.status}`}>경계 검사: {workflow.result.boundaryAssessment.status}</p>
        {workflow.result.boundaryAssessment.messages.map((message) => <p className="video-stabilization-warning" key={message}>{message}</p>)}
        {workflow.result.warnings.map((warning) => <p className="video-stabilization-warning" key={warning}>{warning}</p>)}
      </div> : null}
    </>}
  </section>;
}
