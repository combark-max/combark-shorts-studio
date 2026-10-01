import type {
  ContactSheetFps,
  ContactSheetInterpolation,
  ContactSheetVideoProgress,
} from '../../shared/contactSheetVideo';
import {
  CONTACT_SHEET_FPS_VALUES,
  CONTACT_SHEET_INTERPOLATION_MULTIPLIERS,
} from '../../shared/contactSheetVideo';
import { useContactSheetVideo } from '../contact-sheet/useContactSheetVideo';

export interface ContactSheetVideoDialogProps {
  generalExportInProgress: boolean;
  onClose(): void;
  onBusyChange(busy: boolean): void;
}

function progressMessage(progress: ContactSheetVideoProgress | null): string {
  switch (progress?.stage) {
    case 'analyzing':
      return `이미지 ${progress.sheetIndex}/${progress.sheetCount} 다시 확인 중`;
    case 'extracting':
      return `프레임 ${progress.frameIndex}/${progress.frameCount} 추출 중`;
    case 'encoding':
      return 'MP4 인코딩 중';
    case 'writing-output':
      return 'MP4 저장 중';
    case 'complete':
      return 'MP4 저장 완료';
    default:
      return '영상 생성 준비 중';
  }
}

export function ContactSheetVideoDialog({
  generalExportInProgress,
  onClose,
  onBusyChange,
}: ContactSheetVideoDialogProps) {
  const workflow = useContactSheetVideo(onBusyChange);
  const frameCount = workflow.sheets.length * 16;
  const interpolationMultiplier = workflow.interpolationEnabled
    ? CONTACT_SHEET_INTERPOLATION_MULTIPLIERS[workflow.interpolation]
    : 1;
  const outputFrameCount = frameCount * interpolationMultiplier;
  const canCreate =
    workflow.sheets.length > 0 &&
    workflow.sheets.every(
      ({ analysisStatus }) => analysisStatus === 'recognized',
    ) &&
    !generalExportInProgress &&
    workflow.status !== 'creating';

  return (
    <div className="contact-sheet-video-backdrop">
      <section
        aria-labelledby="contact-sheet-video-heading"
        aria-modal="true"
        className="contact-sheet-video-dialog"
        role="dialog"
      >
        <h2 id="contact-sheet-video-heading">연속 프레임 영상 만들기</h2>
        <button
          type="button"
          disabled={workflow.adding || workflow.status === 'creating'}
          onClick={() => void workflow.addSheets()}
        >
          Contact sheet 이미지 추가
        </button>
        <p className="contact-sheet-format-hint">지원 형식: PNG, JPG, JPEG</p>

        {workflow.sheets.length === 0 ? (
          <p className="contact-sheet-empty">추가된 이미지가 없습니다.</p>
        ) : (
          <ol className="contact-sheet-list">
            {workflow.sheets.map((sheet, index) => (
              <li key={sheet.id}>
                <span className="contact-sheet-order">{index + 1}</span>
                <span className="contact-sheet-name">{sheet.fileName}</span>
                <span className={`contact-sheet-analysis contact-sheet-analysis-${sheet.analysisStatus}`}>
                  {sheet.analysisStatus === 'analyzing'
                    ? '분석 중'
                    : sheet.analysisStatus === 'recognized'
                      ? '16프레임 인식'
                      : '인식 실패'}
                </span>
                {sheet.analysisMessage ? (
                  <span className="contact-sheet-analysis-message">{sheet.analysisMessage}</span>
                ) : null}
                <div className="contact-sheet-item-actions">
                  <button
                    type="button"
                    aria-label={`${sheet.fileName} 위로`}
                    disabled={index === 0 || workflow.status === 'creating'}
                    onClick={() => workflow.moveSheet(index, 'up')}
                  >
                    위로
                  </button>
                  <button
                    type="button"
                    aria-label={`${sheet.fileName} 아래로`}
                    disabled={
                      index === workflow.sheets.length - 1 ||
                      workflow.status === 'creating'
                    }
                    onClick={() => workflow.moveSheet(index, 'down')}
                  >
                    아래로
                  </button>
                  <button
                    type="button"
                    aria-label={`${sheet.fileName} 제거`}
                    disabled={workflow.status === 'creating'}
                    onClick={() => workflow.removeSheet(sheet.id)}
                  >
                    제거
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <label className="contact-sheet-fps">
          <span>FPS</span>
          <select
            aria-label="FPS"
            disabled={workflow.status === 'creating'}
            value={workflow.fps}
            onChange={(event) =>
              workflow.setFps(Number(event.currentTarget.value) as ContactSheetFps)
            }
          >
            {CONTACT_SHEET_FPS_VALUES.map((fps) => (
              <option key={fps} value={fps}>{fps}</option>
            ))}
          </select>
        </label>

        <div className="contact-sheet-interpolation">
          <label>
            <input
              type="checkbox"
              checked={workflow.interpolationEnabled}
              disabled={workflow.status === 'creating'}
              onChange={(event) =>
                workflow.setInterpolationEnabled(event.currentTarget.checked)
              }
            />
            <span>부드러운 미세 동작</span>
          </label>
          <label>
            <span>강도</span>
            <select
              aria-label="강도"
              disabled={
                !workflow.interpolationEnabled || workflow.status === 'creating'
              }
              value={workflow.interpolation}
              onChange={(event) =>
                workflow.setInterpolation(
                  event.currentTarget.value as ContactSheetInterpolation,
                )
              }
            >
              <option value="light">약하게</option>
              <option value="medium">보통</option>
              <option value="strong">많이</option>
            </select>
          </label>
        </div>

        <div className="contact-sheet-summary" aria-live="polite">
          <span>이미지 {workflow.sheets.length}장</span>
          <span>
            원본 {frameCount}프레임 → 출력 {outputFrameCount}프레임 / 예상{' '}
            {outputFrameCount === 0
              ? '0.0'
              : (outputFrameCount / workflow.fps).toFixed(1)}초
          </span>
        </div>

        {workflow.status === 'creating' || workflow.status === 'success' ? (
          <p role="status">{progressMessage(workflow.progress)}</p>
        ) : null}
        {workflow.status === 'success' && workflow.outputPath ? (
          <p className="contact-sheet-success">저장 위치: {workflow.outputPath}</p>
        ) : null}
        {workflow.status === 'error' ? (
          <p className="contact-sheet-error" role="alert">
            연속 프레임 영상을 만들지 못했습니다. 입력 이미지와 FFmpeg 상태를 확인해 주세요.
          </p>
        ) : null}

        <div className="contact-sheet-video-actions">
          {workflow.status === 'creating' ? (
            <button type="button" onClick={() => void workflow.cancel()}>
              작업 취소
            </button>
          ) : (
            <button type="button" onClick={onClose}>닫기</button>
          )}
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void workflow.createVideo()}
          >
            영상 만들기
          </button>
        </div>
      </section>
    </div>
  );
}
