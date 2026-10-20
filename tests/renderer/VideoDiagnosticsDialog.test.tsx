import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoDiagnosticsDialog } from '../../src/renderer/components/VideoDiagnosticsDialog';
import { createMediaUrl } from '../../src/shared/mediaProtocol';

const selected = {
  sourcePath: 'C:\\영상 파일\\사랑#꿈.mp4',
  fileName: '사랑#꿈.mp4',
  metadata: {
    durationMs: 10_000, width: 1080, height: 1920, fps: 30,
    hasVideo: true, hasAudio: false,
  },
  probeStatus: 'ready' as const,
};
const result = {
  candidates: [
    { type: 'brightness-change' as const, startMs: 2_000, endMs: 2_400, peakMs: 2_200, severity: 'low' as const, scoreMultiple: 1.2, scoreLabel: '진단 기준 대비 1.20배', confidence: 'medium' as const },
    { type: 'scene-change' as const, startMs: 1_000, endMs: 1_000, peakMs: 1_000, severity: 'info' as const, scoreMultiple: null, scoreLabel: 'FFmpeg 장면 변화 점수 12.00', confidence: null },
  ],
  uncertainties: [{ code: 'poor-motion-coverage' as const, message: '움직임 측정 영역이 충분하지 않습니다.' }],
  notices: ['의도적인 카메라 이동과 이상 움직임을 완전히 구분할 수 없습니다.'],
};

const api = {
  selectDiagnosticVideo: vi.fn(),
  analyzeDiagnosticVideo: vi.fn(),
  cancelVideoDiagnostics: vi.fn(),
  onVideoDiagnosticsProgress: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.selectDiagnosticVideo.mockResolvedValue(selected);
  api.analyzeDiagnosticVideo.mockResolvedValue(result);
  api.cancelVideoDiagnostics.mockResolvedValue(undefined);
  api.onVideoDiagnosticsProgress.mockReturnValue(vi.fn());
  Object.defineProperty(window, 'combarkDesktop', { configurable: true, value: api });
});
afterEach(cleanup);

function renderDialog(overrides: Partial<React.ComponentProps<typeof VideoDiagnosticsDialog>> = {}) {
  return render(<VideoDiagnosticsDialog
    exportInProgress={false}
    contactSheetBusy={false}
    onBusyChange={vi.fn()}
    onClose={vi.fn()}
    {...overrides}
  />);
}

describe('VideoDiagnosticsDialog', () => {
  it('selects an independent MP4 and displays trustworthy metadata', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));

    expect(screen.getByText('사랑#꿈.mp4')).toBeInTheDocument();
    expect(screen.getByText('1080 × 1920')).toBeInTheDocument();
    expect(screen.getByText('30 FPS')).toBeInTheDocument();
    expect(screen.getByText('오디오 없음')).toBeInTheDocument();
    expect(screen.getByLabelText('선택한 영상 미리보기')).toHaveAttribute('src', createMediaUrl(selected.sourcePath));
  });

  it('shows unknown fields and probe failures instead of guessed values', async () => {
    const user = userEvent.setup();
    api.selectDiagnosticVideo.mockResolvedValue({
      ...selected,
      metadata: { durationMs: null, width: null, height: null, fps: null, hasVideo: null, hasAudio: null },
      probeStatus: 'failed',
      probeMessage: '영상 파일에 접근할 수 없습니다.',
    });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));

    expect(screen.getAllByText('확인할 수 없음').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('영상 파일에 접근할 수 없습니다.');
    expect(screen.getByRole('button', { name: '진단 시작' })).toBeDisabled();
  });

  it('reports progress, result uncertainty, sorted rows, and the score disclaimer', async () => {
    const user = userEvent.setup();
    let progress: ((value: unknown) => void) | undefined;
    api.onVideoDiagnosticsProgress.mockImplementation((listener) => { progress = listener; return vi.fn(); });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    act(() => progress?.({ stage: 'frame-analysis', analyzedMs: 5_000, durationMs: 10_000, percent: 50 }));

    expect(await screen.findByText(/진단 점수와 심각도는 검증된 정확도나 발생 확률이 아닙니다/)).toBeInTheDocument();
    expect(screen.getByText('움직임 측정 영역이 충분하지 않습니다.')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /후보/ });
    expect(rows[0]).toHaveTextContent('장면 전환 후보');
    expect(rows[1]).toHaveTextContent('밝기 변화 후보');
    expect(screen.getByRole('region', { name: '진단 결과 목록' })).toBeInTheDocument();
  });

  it('pauses and safely seeks the local preview when a result is clicked', async () => {
    const user = userEvent.setup();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    const video = screen.getByLabelText('선택한 영상 미리보기') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 1.5 });
    await user.click((await screen.findAllByRole('button', { name: /밝기 변화 후보/ }))[0]);

    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(1.5);
    pause.mockRestore();
  });

  it('blocks close during analysis and treats a requested cancellation as retryable', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let rejectAnalysis: ((error: Error) => void) | undefined;
    api.analyzeDiagnosticVideo.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAnalysis = reject; }));
    renderDialog({ onClose });
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    expect(screen.getByRole('button', { name: '닫기' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '진단 취소' }));
    expect(api.cancelVideoDiagnostics).toHaveBeenCalledOnce();
    await act(async () => rejectAnalysis?.(new Error('FFmpeg 분석 실패')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '진단 시작' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a genuine analysis failure and allows a successful retry', async () => {
    const user = userEvent.setup();
    api.analyzeDiagnosticVideo
      .mockRejectedValueOnce(new Error('FFmpeg 분석 실패'))
      .mockResolvedValueOnce(result);
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('FFmpeg 분석 실패');
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    expect(await screen.findByRole('region', { name: '진단 결과 목록' })).toBeInTheDocument();
    expect(api.analyzeDiagnosticVideo).toHaveBeenCalledTimes(2);
  });

  it('disables analysis while export or contact-sheet work is busy', async () => {
    const user = userEvent.setup();
    const view = renderDialog({ exportInProgress: true });
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    expect(screen.getByRole('button', { name: '진단 시작' })).toBeDisabled();
    view.rerender(<VideoDiagnosticsDialog exportInProgress={false} contactSheetBusy onBusyChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '진단 시작' })).toBeDisabled();
  });

  it('completes normally when mounted under React StrictMode', async () => {
    const user = userEvent.setup();
    render(<StrictMode><VideoDiagnosticsDialog
      exportInProgress={false}
      contactSheetBusy={false}
      onBusyChange={vi.fn()}
      onClose={vi.fn()}
    /></StrictMode>);
    await user.click(screen.getByRole('button', { name: 'MP4 선택' }));
    await user.click(screen.getByRole('button', { name: '진단 시작' }));
    expect(await screen.findByRole('region', { name: '진단 결과 목록' })).toBeInTheDocument();
  });
});
