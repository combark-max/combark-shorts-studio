import type {
  ContactSheetFps,
  ContactSheetOutputFps,
  ContactSheetCropMode,
  ContactSheetInterpolation,
  ContactSheetVideoProgress,
} from '../../shared/contactSheetVideo';
import {
  CONTACT_SHEET_FPS_VALUES,
  CONTACT_SHEET_OUTPUT_FPS_VALUES,
  getContactSheetOutputInfo,
  compareContactSheetBoundary,
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
  const output = getContactSheetOutputInfo(
    frameCount, workflow.fps,
    workflow.interpolationEnabled ? workflow.interpolation : undefined,
    workflow.smoothEnabled ? workflow.outputFps : undefined,
  );
  const dimensionsKnown = workflow.sheets.length > 0 && workflow.sheets.every((sheet) =>
    sheet.analysisStatus === 'recognized' && sheet.details &&
    Number.isSafeInteger(sheet.details.width) && Number.isSafeInteger(sheet.details.height) &&
    sheet.details.width >= 2 && sheet.details.height >= 2,
  );
  const outputWidth = dimensionsKnown ? Math.min(...workflow.sheets.map((sheet) => sheet.details.width)) & ~1 : null;
  const outputHeight = dimensionsKnown ? Math.min(...workflow.sheets.map((sheet) => sheet.details.height)) & ~1 : null;
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
          <span>원본 프레임 속도 (FPS)</span>
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

        <div className="contact-sheet-interpolation">
          <label>
            <input type="checkbox" checked={workflow.smoothEnabled}
              disabled={workflow.status === 'creating'}
              onChange={(event) => workflow.setSmoothEnabled(event.currentTarget.checked)} />
            <span>동작 속도 유지 · 부드러운 영상</span>
          </label>
          <label>
            <span>출력 FPS</span>
            <select aria-label="출력 FPS" value={workflow.outputFps}
              disabled={!workflow.smoothEnabled || workflow.status === 'creating'}
              onChange={(event) => workflow.setOutputFps(Number(event.currentTarget.value) as ContactSheetOutputFps)}>
              {CONTACT_SHEET_OUTPUT_FPS_VALUES.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
            </select>
          </label>
        </div>
        <label className="contact-sheet-fps">
          <span>크롭 기준</span>
          <select aria-label="크롭 기준" value={workflow.cropMode} disabled={workflow.status === 'creating'}
            onChange={(event) => workflow.setCropMode(event.currentTarget.value as ContactSheetCropMode)}>
            <option value="top-left">좌상단 기준 (기존)</option>
            <option value="center">중앙 기준</option>
          </select>
        </label>

        <div className="contact-sheet-summary" aria-live="polite">
          <span>이미지 {workflow.sheets.length}장</span>
          <span>
            원본 {frameCount}프레임 → 출력 {output.frameCount}프레임 / 예상{' '}
            {output.duration.toFixed(1)}초
          </span>
          <span>원본 FPS {workflow.fps} / 출력 FPS {output.fps}</span>
          {outputWidth !== null && outputHeight !== null ? (
            <span>예상 출력 해상도 {outputWidth} × {outputHeight}</span>
          ) : <span>예상 출력 해상도: 분석 정보 없음</span>}
        </div>
        {workflow.sheets.length > 1 ? (
          <div className="contact-sheet-boundaries" aria-label="시트 연결부 경량 진단" aria-live="polite">
            <p>전체 셀의 작은 픽셀 표본을 비교한 참고 정보입니다. 크롭 적용 전 기준이며, 오탐·누락이 있을 수 있습니다. 움직임이나 장면을 인식하지 않으며 영상 생성을 차단하지 않습니다.</p>
            {workflow.sheets.slice(1).map((sheet, index) => {
              const diagnostic = compareContactSheetBoundary(workflow.sheets[index].details, sheet.details);
              return <p key={sheet.id} className={diagnostic === 'warning' ? 'contact-sheet-boundary-warning' : undefined}>
                연결부 {index + 1} → {index + 2}: {diagnostic === 'warning'
                  ? '픽셀 변화가 큽니다. 연결 시 갑작스러운 변화가 보일 수 있습니다.'
                  : diagnostic === 'normal' ? '큰 픽셀 변화가 감지되지 않았습니다.' : '진단하지 못했습니다. 영상 생성은 계속할 수 있습니다.'}
              </p>;
            })}
          </div>
        ) : null}

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
