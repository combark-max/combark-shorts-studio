import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoStabilizationPanel } from '../../src/renderer/components/VideoStabilizationPanel';
import type { DiagnosticCandidate, SelectedDiagnosticVideo } from '../../src/shared/videoDiagnostics';
import type { StabilizationPreviewManifest } from '../../src/shared/videoStabilization';

const selected: SelectedDiagnosticVideo = {
  sourcePath: 'C:\\video.mp4', fileName: 'video.mp4', probeStatus: 'ready',
  metadata: { durationMs: 20_000, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: true },
};
const candidate: DiagnosticCandidate = {
  type: 'motion-jitter', startMs: 7_900, endMs: 8_100, peakMs: 8_000,
  severity: 'medium', scoreMultiple: 2, scoreLabel: 'fixture', confidence: 'high',
};
const manifest: StabilizationPreviewManifest = {
  sourcePath: 'C:\\video.mp4', sourceFileName: 'video.mp4',
  candidateKey: 'motion-jitter:7900:8100:8000', candidateType: 'motion-jitter',
  candidatePeakMs: 8_000, fps: 30,
  previewStartFrame: 165, previewEndFrameExclusive: 345,
  correctionStartFrame: 180, correctionEndFrameExclusive: 330,
  strength: 'weak', requestedZoomPercent: 2, appliedZoomPercent: 2,
  encoder: 'libx264', selectionMode: 'range',
};

describe('VideoStabilizationPanel', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.assign(window, { combarkDesktop: {
      createStabilizationPreview: vi.fn(),
      cancelStabilizationPreview: vi.fn().mockResolvedValue(undefined),
      disposeStabilizationPreview: vi.fn().mockResolvedValue(true),
      onStabilizationPreviewProgress: vi.fn(() => vi.fn()),
    } });
  });

  it('shows exact controls and requires boundary confirmation before creation', async () => {
    render(<VideoStabilizationPanel selected={selected} candidate={candidate} blocked={false} onBusyChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '끄기' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '약하게' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '보통' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1%' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2%' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '3%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5~10초 시험 보정' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /장면 경계/ }));
    expect(screen.getByRole('button', { name: '5~10초 시험 보정' })).toBeEnabled();
  });

  it('blocks unsupported and uncertain candidates and requires scale warning consent', async () => {
    const { rerender } = render(<VideoStabilizationPanel selected={selected} candidate={{ ...candidate, type: 'scene-change' }} blocked={false} onBusyChange={vi.fn()} />);
    expect(screen.getByText(/안정화 대상이 아닙니다/)).toBeInTheDocument();
    rerender(<VideoStabilizationPanel selected={selected} candidate={{ ...candidate, type: 'rotation-change', confidence: null }} blocked={false} onBusyChange={vi.fn()} />);
    expect(screen.getByText(/신뢰도가 부족/)).toBeInTheDocument();
    rerender(<VideoStabilizationPanel selected={selected} candidate={{ ...candidate, type: 'scale-change' }} blocked={false} onBusyChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /의도적인 줌/ })).toBeInTheDocument();
  });

  it('shows a verified A/B result at the same source time with only one audible player', async () => {
    vi.mocked(window.combarkDesktop.createStabilizationPreview).mockResolvedValue({
      previewId: 'id', previewPath: 'C:\\Temp\\preview.mp4', sourceStartMs: 5_500,
      sourceEndMs: 11_500, durationMs: 6_000, videoFrameCount: 180, hasAudio: true,
      encoderUsed: 'libx264', manifest,
      boundaryAssessment: { status: 'warning', metrics: [], messages: ['종료 연결부 점프'] },
      warnings: ['검은 가장자리를 확인하세요.'],
    });
    render(<VideoStabilizationPanel selected={selected} candidate={candidate} blocked={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /장면 경계/ }));
    await userEvent.click(screen.getByRole('button', { name: '5~10초 시험 보정' }));
    await screen.findByText('종료 연결부 점프');
    const original = screen.getByLabelText('원본 A/B 영상') as HTMLVideoElement;
    const corrected = screen.getByLabelText('보정본 A/B 영상') as HTMLVideoElement;
    const originalButton = screen.getByRole('button', { name: '원본 보기' });
    const correctedButton = screen.getByRole('button', { name: '보정본 보기' });
    Object.defineProperty(original, 'duration', { configurable: true, value: 20 });
    Object.defineProperty(corrected, 'duration', { configurable: true, value: 6 });
    expect(originalButton).toBeDisabled();
    expect(correctedButton).toBeDisabled();
    fireEvent.loadedMetadata(corrected);
    fireEvent.loadedMetadata(original);
    expect(original.currentTime).toBeCloseTo(5.5);
    expect(corrected.currentTime).toBe(0);
    fireEvent.seeked(original);
    expect(originalButton).toBeEnabled();
    expect(correctedButton).toBeEnabled();
    expect(screen.getByText('원본').parentElement).toHaveTextContent('video.mp4C:\\video.mp4');
    expect(screen.getByText('진단 후보').parentElement).toHaveTextContent(
      `반복 흔들림 후보 · 00:08.000${manifest.candidateKey}`,
    );
    expect(screen.getByText('선택·프레임률').parentElement).toHaveTextContent('제한 구간 · 30 fps');
    expect(screen.getByText('시험 영상').parentElement).toHaveTextContent('00:05.500–00:11.500');
    expect(screen.getByText('안정화 코어').parentElement).toHaveTextContent('00:06.000–00:11.000');
    expect(screen.getByText('원본 핸들').parentElement).toHaveTextContent('앞 0.500초 · 뒤 0.500초');
    expect(screen.getByText('보정 설정').parentElement).toHaveTextContent('약하게 · 요청 2% · 적용 2%');
    expect(screen.getAllByText('CPU (libx264)')).toHaveLength(2);
    original.currentTime = 8;
    expect(original.muted).toBe(false);
    expect(corrected.muted).toBe(true);
    fireEvent.timeUpdate(original);
    fireEvent.click(correctedButton);
    expect(corrected.currentTime).toBeCloseTo(2.5);
    fireEvent.seeked(corrected);
    expect(original.muted).toBe(true);
    expect(corrected.muted).toBe(false);
    corrected.currentTime = 2.5;
    fireEvent.timeUpdate(corrected);
    fireEvent.click(originalButton);
    fireEvent.seeked(original);
    await waitFor(() => expect(original.currentTime).toBeCloseTo(8));
    expect(original.muted).toBe(false);
    expect(corrected.muted).toBe(true);
    expect(screen.getByText('검은 가장자리를 확인하세요.')).toBeInTheDocument();
  });

  it('loads fresh players when a result for the same source is replaced', async () => {
    const first = {
      previewId: 'first', previewPath: 'C:\\Temp\\first.mp4', sourceStartMs: 5_500,
      sourceEndMs: 11_500, durationMs: 6_000, videoFrameCount: 180, hasAudio: true,
      encoderUsed: 'libx264' as const, manifest,
      boundaryAssessment: { status: 'safe' as const, metrics: [], messages: [] }, warnings: [],
    };
    vi.mocked(window.combarkDesktop.createStabilizationPreview)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, previewId: 'second', previewPath: 'C:\\Temp\\second.mp4' });
    render(<VideoStabilizationPanel selected={selected} candidate={candidate} blocked={false} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /장면 경계/ }));
    await userEvent.click(screen.getByRole('button', { name: '5~10초 시험 보정' }));
    const firstOriginal = await screen.findByLabelText('원본 A/B 영상') as HTMLVideoElement;
    const firstCorrected = screen.getByLabelText('보정본 A/B 영상') as HTMLVideoElement;
    fireEvent.loadedMetadata(firstOriginal);
    fireEvent.loadedMetadata(firstCorrected);
    fireEvent.seeked(firstOriginal);
    expect(screen.getByRole('button', { name: '보정본 보기' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '5~10초 시험 보정' }));
    await waitFor(() => expect(
      (screen.getByLabelText('보정본 A/B 영상') as HTMLVideoElement).getAttribute('src'),
    ).toContain('second.mp4'));
    const secondOriginal = screen.getByLabelText('원본 A/B 영상') as HTMLVideoElement;
    const secondCorrected = screen.getByLabelText('보정본 A/B 영상') as HTMLVideoElement;
    expect(secondOriginal).not.toBe(firstOriginal);
    expect(secondCorrected).not.toBe(firstCorrected);
    expect(screen.getByRole('button', { name: '보정본 보기' })).toBeDisabled();
    fireEvent.loadedMetadata(secondCorrected);
    expect(screen.getByRole('button', { name: '보정본 보기' })).toBeDisabled();
    fireEvent.loadedMetadata(secondOriginal);
    fireEvent.seeked(secondOriginal);
    expect(screen.getByRole('button', { name: '보정본 보기' })).toBeEnabled();
  });
});
