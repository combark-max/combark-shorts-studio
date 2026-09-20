import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreviewPanel } from '../../src/renderer/components/PreviewPanel';
import type { MediaAsset, Scene } from '../../src/shared/project/types';

const media: MediaAsset[] = [
  {
    id: 'first-image',
    kind: 'image',
    sourcePath: 'C:\\media folder\\first image.jpg',
    fileName: 'first image.jpg',
  },
  {
    id: 'video',
    kind: 'video',
    sourcePath: 'C:\\media\\clip.mp4',
    fileName: 'clip.mp4',
  },
  {
    id: 'last-image',
    kind: 'image',
    sourcePath: 'C:\\media\\last.png',
    fileName: 'last.png',
  },
];

const scenes: Scene[] = [
  { mediaId: 'first-image', durationMs: 3000, subtitle: '첫 자막' },
  { mediaId: 'video', durationMs: null, subtitle: '영상 자막' },
  { mediaId: 'last-image', durationMs: 2000, subtitle: '' },
];

function StatefulPreview() {
  const [selectedMediaId, setSelectedMediaId] = useState('first-image');

  return (
    <PreviewPanel
      media={media}
      scenes={scenes}
      selectedMediaId={selectedMediaId}
      onSelectScene={setSelectedMediaId}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PreviewPanel', () => {
  it('renders the scene selected by its parent', () => {
    render(
      <PreviewPanel
        media={media}
        scenes={scenes}
        selectedMediaId="video"
        onSelectScene={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    expect(screen.getByText('영상 자막')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('renders the first image and its subtitle in the preview', () => {
    render(<StatefulPreview />);

    expect(screen.getByRole('img', { name: 'first image.jpg' })).toHaveAttribute(
      'src',
      'combark-media://local/?path=C%3A%5Cmedia+folder%5Cfirst+image.jpg',
    );
    expect(screen.getByText('첫 자막')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('moves between image and video scenes with previous and next', () => {
    render(<StatefulPreview />);

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInstanceOf(
      HTMLVideoElement,
    );
    expect(screen.getByText('영상 자막')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
  });

  it('preserves an image scene remaining time across pause and resume', () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<StatefulPreview />);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('advances when video ends and stops on the final scene', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<StatefulPreview />);
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    fireEvent.ended(screen.getByLabelText('clip.mp4 미리보기'));

    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    fireEvent.load(screen.getByRole('img', { name: 'last.png' }));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('shows an error without throwing when media loading fails', () => {
    render(<StatefulPreview />);

    fireEvent.error(screen.getByRole('img', { name: 'first image.jpg' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '미디어를 불러오지 못했습니다.',
    );
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();
  });

  it('handles a rejected video play request', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new Error('play blocked'),
    );
    render(<StatefulPreview />);
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '미디어를 재생하지 못했습니다.',
    );
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });
});
