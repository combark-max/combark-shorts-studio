import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewPanel } from '../../src/renderer/components/PreviewPanel';
import type {
  MediaAsset,
  NarrationAsset,
  Scene,
} from '../../src/shared/project/types';

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
  { mediaId: 'first-image', durationMs: 3000, subtitle: '첫 자막', subtitlePosition: 'top', subtitleSize: 'large' },
  { mediaId: 'video', durationMs: null, subtitle: '영상 자막', subtitlePosition: 'center', subtitleSize: 'small' },
  { mediaId: 'last-image', durationMs: 2000, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
];

const narration: NarrationAsset = {
  sourcePath: 'C:\\audio folder\\voice.mp3',
  fileName: 'voice.mp3',
};

function StatefulPreview({
  narrationAsset = null,
  initialMediaId = 'first-image',
}: {
  narrationAsset?: NarrationAsset | null;
  initialMediaId?: string;
}) {
  const [selectedMediaId, setSelectedMediaId] = useState(initialMediaId);

  return (
    <PreviewPanel
      media={media}
      narration={narrationAsset}
      scenes={scenes}
      selectedMediaId={selectedMediaId}
      onSelectScene={setSelectedMediaId}
    />
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PreviewPanel', () => {
  it('guides an empty project to add an image or video', () => {
    render(
      <PreviewPanel
        media={[]}
        narration={null}
        scenes={[]}
        selectedMediaId={null}
        onSelectScene={vi.fn()}
      />,
    );

    expect(
      screen.getByText('사진 또는 영상을 추가하면 편집을 시작할 수 있습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '처음부터' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '재생' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  it('guides a narration-only project to add an image or video', () => {
    render(
      <PreviewPanel
        media={[]}
        narration={narration}
        scenes={[]}
        selectedMediaId={null}
        onSelectScene={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        '내레이션은 선택되어 있습니다. 미리보려면 사진 또는 영상을 추가하세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeDisabled();
  });

  it('keeps the generic empty message when the selected scene is missing', () => {
    render(
      <PreviewPanel
        media={media}
        narration={null}
        scenes={scenes}
        selectedMediaId="missing"
        onSelectScene={vi.fn()}
      />,
    );

    expect(screen.getByText('미리볼 장면이 없습니다.')).toBeInTheDocument();
  });

  it('renders the scene selected by its parent', () => {
    render(
      <PreviewPanel
        media={media}
        narration={null}
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
    const subtitle = screen.getByText('첫 자막');
    expect(subtitle).toBeInTheDocument();
    expect(subtitle.style.fontSize).toBe(`${(80 / 1080) * 100}cqw`);
    expect(subtitle.style.top).toBe(`${(150 / 1920) * 100}%`);
    expect(subtitle.style.left).toBe(`${(80 / 1080) * 100}%`);
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('renders a centered small subtitle using the shared normalized style', () => {
    render(<StatefulPreview initialMediaId="video" />);

    const subtitle = screen.getByText('영상 자막');
    expect(subtitle.style.fontSize).toBe(`${(48 / 1080) * 100}cqw`);
    expect(subtitle.style.top).toBe('50%');
    expect(subtitle.style.transform).toBe('translateY(-50%)');
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

  it('starts narration at zero, pauses it, and resumes from the same position', async () => {
    render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    audio.play = play;
    audio.pause = pause;
    audio.currentTime = 0;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audio.currentTime).toBe(0);
    expect(play).toHaveBeenCalledOnce();

    audio.currentTime = 1.25;
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(1.25);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(1.25);
  });

  it('keeps narration playing across scenes and pauses it after the final scene', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    audio.play = audioPlay;
    audio.pause = audioPause;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    expect(audioPlay).toHaveBeenCalledOnce();
    expect(audioPause).not.toHaveBeenCalled();

    fireEvent.ended(screen.getByLabelText('clip.mp4 미리보기'));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
    expect(audioPause).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('keeps an ended narration silent on pause and resume until restart', () => {
    render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).toHaveBeenCalledOnce();
    fireEvent.ended(audio);

    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '처음부터' }));
    expect(audioPlay).toHaveBeenCalledTimes(2);
  });

  it('restarts the first scene, visual timing, video, and narration from zero', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(
      <StatefulPreview narrationAsset={narration} initialMediaId="video" />,
    );
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).toHaveBeenCalledOnce();
    video.currentTime = 2;
    audio.currentTime = 8;

    fireEvent.click(screen.getByRole('button', { name: '처음부터' }));

    expect(video.currentTime).toBe(0);
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
    expect(audioPlay).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(2999));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('resets the full image duration when restarting during the first scene', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<StatefulPreview />);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(screen.getByRole('button', { name: '처음부터' }));

    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('restarts a playing first video from zero', () => {
    render(
      <PreviewPanel
        media={[media[1]]}
        narration={narration}
        scenes={[scenes[1]]}
        selectedMediaId="video"
        onSelectScene={vi.fn()}
      />,
    );
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const videoPlay = vi.fn().mockResolvedValue(undefined);
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    video.play = videoPlay;
    audio.play = audioPlay;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(videoPlay).toHaveBeenCalledOnce();
    expect(audioPlay).toHaveBeenCalledOnce();
    video.currentTime = 2;
    audio.currentTime = 8;

    fireEvent.click(screen.getByRole('button', { name: '처음부터' }));

    expect(video.currentTime).toBe(0);
    expect(audio.currentTime).toBe(0);
    expect(videoPlay).toHaveBeenCalledTimes(2);
    expect(audioPlay).toHaveBeenCalledTimes(2);
  });

  it('continues visual playback when narration loading fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;

    fireEvent.error(audio);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '내레이션을 불러오지 못했습니다.',
    );
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('continues visual playback when narration play is rejected', async () => {
    render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    audio.play = vi.fn().mockRejectedValue(new Error('audio blocked'));

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole('alert')).toHaveTextContent(
      '내레이션을 재생하지 못했습니다.',
    );
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
  });

  it('pauses narration when video playback fails', async () => {
    render(
      <StatefulPreview narrationAsset={narration} initialMediaId="video" />,
    );
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    video.play = vi.fn().mockRejectedValue(new Error('video blocked'));
    audio.play = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    audio.pause = audioPause;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole('alert')).toHaveTextContent(
      '미디어를 재생하지 못했습니다.',
    );
    expect(audioPause).toHaveBeenCalledOnce();
  });
});
