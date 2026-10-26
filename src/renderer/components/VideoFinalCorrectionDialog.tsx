import { createMediaUrl } from '../../shared/mediaProtocol';
import { useVideoFinalCorrection } from '../video-final-correction/useVideoFinalCorrection';
import { useStabilizationABPlayback } from '../video-stabilization/useStabilizationABPlayback';

export interface VideoFinalCorrectionDialogProps {
  blocked: boolean;
  onBusyChange(busy: boolean): void;
  onClose(): void;
}

function stageLabel(stage: NonNullable<ReturnType<typeof useVideoFinalCorrection>['progress']>['stage']): string {
  return {
    checking: '원본 전체 검사',
    detecting: '움직임 분석',
    transforming: '영상 보정',
    verifying: '결과 전체 검증',
    publishing: '결과 저장',
    complete: '보정 완료',
  }[stage];
}

export function VideoFinalCorrectionDialog({
  blocked,
  onBusyChange,
  onClose,
}: VideoFinalCorrectionDialogProps) {
  const workflow = useVideoFinalCorrection(onBusyChange);
  const playback = useStabilizationABPlayback(workflow.result);
  const canStart = Boolean(workflow.selected && workflow.outputPath) &&
    !workflow.busy && !blocked;

  return <div className="modal-backdrop">
    <section className="modal-card video-final-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="video-final-correction-title">
      <header className="modal-header">
        <div>
          <h2 id="video-final-correction-title">영상 최종 보정</h2>
          <p>완성된 MP4를 프로젝트와 독립적으로 보정하고 새 파일로 저장합니다.</p>
        </div>
        <button type="button" disabled={workflow.busy} onClick={onClose}>닫기</button>
      </header>

      <div className="video-final-correction-inputs">
        <button type="button" disabled={workflow.busy} onClick={() => void workflow.selectVideo()}>
          완성 MP4 선택
        </button>
        {workflow.selected ? <p><strong>원본</strong><br />{workflow.selected.sourcePath}</p> : null}
        <button type="button" disabled={!workflow.selected || workflow.busy} onClick={() => void workflow.selectOutput()}>
          출력 경로 선택
        </button>
        {workflow.outputPath ? <p><strong>출력</strong><br />{workflow.outputPath}</p> : null}
        <label>보정 방식
          <select value={workflow.method} disabled={workflow.busy} onChange={(event) => workflow.setMethod(event.target.value as 'basic' | 'strong')}>
            <option value="basic">기본 흔들림 보정</option>
            {workflow.selected?.capabilities.strong
              ? <option value="strong">강력 흔들림 보정</option>
              : null}
          </select>
        </label>
        {workflow.method === 'strong'
          ? <p className="video-stabilization-warning" data-testid="strong-correction-warning">
            더 긴 움직임 분석과 강한 안정화를 사용합니다. 고정 2% 확대 및 화면 이동으로 가장자리 일부가 잘릴 수 있습니다.
          </p>
          : <p className="video-stabilization-warning">고정 2% 확대를 사용하며 가장자리 일부가 잘릴 수 있습니다.</p>}
      </div>

      {blocked ? <p className="video-stabilization-warning">다른 미디어 작업이 진행 중입니다.</p> : null}
      <div className="video-stabilization-actions">
        <button type="button" disabled={!canStart} onClick={() => void workflow.start()}>보정 시작</button>
        {workflow.status === 'running'
          ? <button type="button" onClick={() => void workflow.cancel()}>보정 취소</button>
          : null}
      </div>
      {workflow.progress ? <div role="status">
        <p>{stageLabel(workflow.progress.stage)} · {workflow.progress.percent}%</p>
        <progress max="100" value={workflow.progress.percent} />
      </div> : null}
      {workflow.error ? <p role="alert" className="video-stabilization-error">{workflow.error}</p> : null}

      {workflow.result ? <section className="video-stabilization-comparison" aria-label="최종 보정 전후 비교">
        <h3>보정 완료</h3>
        <p>{workflow.result.width}×{workflow.result.height} · {workflow.result.fps} fps · {workflow.result.frameCount} 프레임 · 오디오 {workflow.result.audioStreamCount}개</p>
        <div className="video-stabilization-ab-controls">
          <button type="button" disabled={!playback.ready} aria-pressed={playback.activeVersion === 'original'} onClick={() => playback.switchVersion('original')}>원본 보기</button>
          <button type="button" disabled={!playback.ready} aria-pressed={playback.activeVersion === 'corrected'} onClick={() => playback.switchVersion('corrected')}>보정본 보기</button>
        </div>
        {playback.message ? <p role="alert" className="video-stabilization-warning">{playback.message}</p> : null}
        <video
          ref={playback.originalRef}
          aria-label="최종 보정 원본 영상"
          hidden={playback.activeVersion !== 'original'}
          controls
          preload="metadata"
          src={createMediaUrl(workflow.result.sourcePath)}
          onLoadedMetadata={() => playback.onLoadedMetadata('original')}
          onTimeUpdate={() => playback.onTimeUpdate('original')}
          onPlay={() => playback.onPlay('original')}
          onPause={() => playback.onPause('original')}
          onRateChange={() => playback.onRateChange('original')}
          onEnded={() => playback.onEnded('original')}
        />
        <video
          ref={playback.correctedRef}
          aria-label="최종 보정 결과 영상"
          hidden={playback.activeVersion !== 'corrected'}
          controls
          preload="metadata"
          muted
          src={createMediaUrl(workflow.result.outputPath)}
          onLoadedMetadata={() => playback.onLoadedMetadata('corrected')}
          onTimeUpdate={() => playback.onTimeUpdate('corrected')}
          onPlay={() => playback.onPlay('corrected')}
          onPause={() => playback.onPause('corrected')}
          onRateChange={() => playback.onRateChange('corrected')}
          onEnded={() => playback.onEnded('corrected')}
        />
      </section> : null}
    </section>
  </div>;
}
