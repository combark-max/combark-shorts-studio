import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoFinalCorrectionDialog } from '../../src/renderer/components/VideoFinalCorrectionDialog';

const selected = {
  sourcePath: 'C:\\media\\source.mp4', fileName: 'source.mp4',
  metadata: { durationMs: 12_000, width: 1_080, height: 1_920, fps: 30, hasVideo: true, hasAudio: true },
  capabilities: { basic: true as const, strong: true },
};
const outputPath = 'C:\\media\\source-corrected.mp4';
const corrected = {
  sourcePath: selected.sourcePath, outputPath, method: 'basic' as const,
  width: 1_080, height: 1_920, fps: 30, frameCount: 360,
  durationMs: 12_000, audioStreamCount: 1,
};

describe('VideoFinalCorrectionDialog', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    Object.assign(window, { combarkDesktop: {
      selectFinalCorrectionVideo: vi.fn().mockResolvedValue(selected),
      selectFinalCorrectionOutput: vi.fn().mockResolvedValue(outputPath),
      startVideoFinalCorrection: vi.fn().mockResolvedValue(corrected),
      cancelVideoFinalCorrection: vi.fn().mockResolvedValue(undefined),
      onVideoFinalCorrectionProgress: vi.fn((listener) => {
        listener({ stage: 'transforming', percent: 70, processedFrames: 180, totalFrames: 360 });
        return vi.fn();
      }),
    } });
  });

  it('offers only verified methods, explains strong crop risk, and requires source plus output', async () => {
    render(<VideoFinalCorrectionDialog blocked={false} onBusyChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '영상 최종 보정' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '보정 방식' })).toHaveValue('basic');
    expect(screen.getByText('기본 흔들림 보정')).toBeInTheDocument();
    expect(screen.queryByText(/강력 흔들림/)).not.toBeInTheDocument();
    expect(screen.queryByText(/인물.*배경|형태 일관성/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보정 시작' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '완성 MP4 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '출력 경로 선택' }));
    expect(Array.from((screen.getByRole('combobox') as HTMLSelectElement).options).map((option) => option.value))
      .toEqual(['basic', 'strong']);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'strong');
    expect(screen.getByTestId('strong-correction-warning')).toBeInTheDocument();
    expect(screen.getByText(selected.sourcePath)).toBeInTheDocument();
    expect(screen.getByText(outputPath)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보정 시작' })).toBeEnabled();
  });

  it('shows progress then compares the complete original and corrected files', async () => {
    render(<VideoFinalCorrectionDialog blocked={false} onBusyChange={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '완성 MP4 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '출력 경로 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '보정 시작' }));
    expect(await screen.findByText(/보정 완료/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
    const original = screen.getByLabelText('최종 보정 원본 영상') as HTMLVideoElement;
    const output = screen.getByLabelText('최종 보정 결과 영상') as HTMLVideoElement;
    Object.defineProperty(original, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(output, 'duration', { configurable: true, value: 12 });
    fireEvent.loadedMetadata(original);
    fireEvent.loadedMetadata(output);
    fireEvent.seeked(original);
    expect(screen.getByRole('button', { name: '보정본 보기' })).toBeEnabled();
    expect(original.getAttribute('src')).toContain('source.mp4');
    expect(output.getAttribute('src')).toContain('source-corrected.mp4');
  });
});
