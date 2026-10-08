import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewPanel } from '../../src/renderer/components/PreviewPanel';
import type { TimelinePlaybackSnapshot } from '../../src/renderer/project/timelineLayout';
import { createMediaUrl } from '../../src/shared/mediaProtocol';
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
  { mediaId: 'first-image', durationMs: 3000, playbackDurationMs: null, subtitle: '첫 자막', subtitlePosition: 'top', subtitleSize: 'large' },
  { mediaId: 'video', durationMs: null, playbackDurationMs: null, subtitle: '영상 자막', subtitlePosition: 'center', subtitleSize: 'small' },
  { mediaId: 'last-image', durationMs: 2000, playbackDurationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
];

const narration: NarrationAsset = {
  sourcePath: 'C:\\audio folder\\voice.mp3',
  fileName: 'voice.mp3',
};

function StatefulPreview({
  narrationAsset = null,
  initialSceneIndex = 0,
  mediaList = media,
  sceneList = scenes,
  onPlaybackSnapshotChange,
}: {
  narrationAsset?: NarrationAsset | null;
  initialSceneIndex?: number;
  mediaList?: MediaAsset[];
  sceneList?: Scene[];
  onPlaybackSnapshotChange?: (snapshot: TimelinePlaybackSnapshot) => void;
}) {
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(initialSceneIndex);

  return (
    <PreviewPanel
      media={mediaList}
      narration={narrationAsset}
      scenes={sceneList}
      selectedSceneIndex={selectedSceneIndex}
      onSelectScene={setSelectedSceneIndex}
      onPlaybackSnapshotChange={onPlaybackSnapshotChange}
    />
  );
}

function setMediaDuration(element: HTMLMediaElement, duration: number): void {
  Object.defineProperty(element, 'duration', {
    configurable: true,
    value: duration,
  });
}

function loadVideoDuration(
  container: HTMLElement,
  mediaId: string,
  duration: number,
): HTMLVideoElement {
  const video = container.querySelector(
    `video[data-preview-metadata-id="${mediaId}"]`,
  ) as HTMLVideoElement;
  expect(video).not.toBeNull();
  setMediaDuration(video, duration);
  fireEvent.loadedMetadata(video);
  return video;
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
  it('places controls beside the frame, then seek, then time without a visible heading', () => {
    const { container } = render(
      <StatefulPreview mediaList={[media[0]]} sceneList={[scenes[0]]} />,
    );
    const stage = container.querySelector('.preview-stage') as HTMLElement;
    const frame = container.querySelector('.preview-frame') as HTMLElement;
    const controls = container.querySelector('.preview-controls') as HTMLElement;
    const seek = container.querySelector('.preview-seek') as HTMLElement;
    const time = container.querySelector('.preview-time') as HTMLElement;
    const panel = container.querySelector('.preview-panel') as HTMLElement;

    expect(stage).toContainElement(frame);
    expect(stage).toContainElement(controls);
    expect(stage).not.toContainElement(seek);
    expect(stage.nextElementSibling).toBe(seek);
    expect(seek.nextElementSibling).toBe(time);
    expect(panel).toHaveAttribute('aria-label', '미리보기');
    expect(screen.queryByRole('heading', { name: '미리보기' })).toBeNull();
    expect(
      within(controls).getByRole('button', { name: '처음부터' }),
    ).toBeInTheDocument();
    expect(within(controls).getAllByRole('button')).toHaveLength(4);
  });

  it('mutes source audio and seeks an extended video to the modulo source position', () => {
    const extendedVideo = { ...scenes[1], playbackDurationMs: 25_000 };
    const { container } = render(
      <StatefulPreview
        initialSceneIndex={0}
        mediaList={[media[1]]}
        sceneList={[extendedVideo]}
      />,
    );
    loadVideoDuration(container, 'video', 10);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 10);
    fireEvent.loadedMetadata(video);

    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveProperty('loop', true);
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '23000' } },
    );
    expect(video.currentTime).toBe(3);
  });

  it('ends a shortened video scene from the project clock before source EOF', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const shortVideo = { ...scenes[1], playbackDurationMs: 600 };
    const { container } = render(
      <StatefulPreview
        mediaList={[media[1], media[2]]}
        sceneList={[shortVideo, scenes[2]]}
      />,
    );
    loadVideoDuration(container, 'video', 10);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 10);
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(599));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
  });

  it('uses a newly shortened duration immediately for the selected video scene', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const initialVideo = { ...scenes[1], playbackDurationMs: 1500 };
    const shortenedVideo = { ...initialVideo, playbackDurationMs: 500 };
    const { container, rerender } = render(
      <StatefulPreview
        mediaList={[media[1], media[2]]}
        sceneList={[initialVideo, scenes[2]]}
      />,
    );
    loadVideoDuration(container, 'video', 1000);
    const video = screen.getByLabelText(
      'clip.mp4 미리보기',
    ) as HTMLVideoElement;
    setMediaDuration(video, 1);
    fireEvent.loadedMetadata(video);

    rerender(
      <StatefulPreview
        mediaList={[media[1], media[2]]}
        sceneList={[shortenedVideo, scenes[2]]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
  });

  it('uses a newly extended duration immediately and loops until its new end', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const initialVideo = { ...scenes[1], playbackDurationMs: 500 };
    const extendedVideo = { ...initialVideo, playbackDurationMs: 3500 };
    const { container, rerender } = render(
      <StatefulPreview
        mediaList={[media[1], media[2]]}
        sceneList={[initialVideo, scenes[2]]}
      />,
    );
    loadVideoDuration(container, 'video', 1000);
    let video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 1);
    fireEvent.loadedMetadata(video);

    rerender(
      <StatefulPreview
        mediaList={[media[1], media[2]]}
        sceneList={[extendedVideo, scenes[2]]}
      />,
    );
    video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    expect(video.loop).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    await act(async () => vi.advanceTimersByTimeAsync(3499));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
  });

  it('uses a newly extended duration for an immediate modulo seek', () => {
    const initialVideo = { ...scenes[1], playbackDurationMs: 500 };
    const extendedVideo = { ...initialVideo, playbackDurationMs: 3500 };
    const { container, rerender } = render(
      <StatefulPreview mediaList={[media[1]]} sceneList={[initialVideo]} />,
    );
    loadVideoDuration(container, 'video', 1000);
    let video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 1);
    fireEvent.loadedMetadata(video);

    rerender(
      <StatefulPreview mediaList={[media[1]]} sceneList={[extendedVideo]} />,
    );
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '2500' } },
    );

    video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    expect(video.currentTime).toBe(0.5);
  });

  it('reports its project clock as a read-only timeline snapshot', async () => {
    vi.useFakeTimers();
    const onPlaybackSnapshotChange = vi.fn();
    render(
      <StatefulPreview
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
        onPlaybackSnapshotChange={onPlaybackSnapshotChange}
      />,
    );

    expect(onPlaybackSnapshotChange).toHaveBeenLastCalledWith({
      currentTimeMs: 0,
      totalDurationMs: 3000,
      ready: true,
      durationUnavailable: false,
      sceneTimings: [
        { sceneIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000 },
      ],
      narrationDurationMs: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(onPlaybackSnapshotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTimeMs: 500 }),
    );

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '1500' } },
    );
    expect(onPlaybackSnapshotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTimeMs: 1500 }),
    );
  });

  it('reports an unready timeline instead of partial video geometry', () => {
    const onPlaybackSnapshotChange = vi.fn();
    render(
      <StatefulPreview
        onPlaybackSnapshotChange={onPlaybackSnapshotChange}
      />,
    );

    expect(onPlaybackSnapshotChange).toHaveBeenLastCalledWith({
      currentTimeMs: 0,
      totalDurationMs: 0,
      ready: false,
      durationUnavailable: false,
      sceneTimings: [],
      narrationDurationMs: undefined,
    });
  });

  it('enables the project seek bar only after every video duration is ready', () => {
    const { container } = render(<StatefulPreview />);
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });

    expect(seekBar).toBeDisabled();
    expect(screen.getByText('00:00 / --:--')).toBeInTheDocument();

    const metadataVideo = container.querySelector(
      'video[data-preview-metadata-id="video"]',
    ) as HTMLVideoElement;
    expect(metadataVideo).not.toBeNull();
    setMediaDuration(metadataVideo, 4);
    fireEvent.loadedMetadata(metadataVideo);

    expect(seekBar).toBeEnabled();
    expect(seekBar).toHaveAttribute('max', '9000');
    expect(screen.getByText('00:00 / 00:09')).toBeInTheDocument();
  });

  it('keeps the seek bar disabled when video metadata fails', () => {
    const onPlaybackSnapshotChange = vi.fn();
    const { container } = render(
      <StatefulPreview
        onPlaybackSnapshotChange={onPlaybackSnapshotChange}
      />,
    );
    const metadataVideo = container.querySelector(
      'video[data-preview-metadata-id="video"]',
    ) as HTMLVideoElement;

    fireEvent.error(metadataVideo);

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toBeDisabled();
    expect(screen.getByText('00:00 / --:--')).toBeInTheDocument();
    expect(onPlaybackSnapshotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ready: false,
        durationUnavailable: true,
      }),
    );
  });

  it('loads metadata once for repeated scenes using the same video', () => {
    const { container } = render(
      <StatefulPreview sceneList={[scenes[1], scenes[1]]} />,
    );

    expect(
      container.querySelectorAll('video[data-preview-metadata-id="video"]'),
    ).toHaveLength(1);
  });

  it('seeks into a paused image and advances after only its remaining time', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });

    fireEvent.change(seekBar, { target: { value: '1500' } });
    expect(screen.getByText('00:01 / 00:09')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(1499));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('restarts a playing image timer from the newly sought position without a duplicate timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '2000' } },
    );

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(screen.getByRole('img', { name: 'first image.jpg' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('seeks within the selected video while remaining paused', () => {
    const { container } = render(<StatefulPreview initialSceneIndex={1} />);
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '5000' } },
    );

    expect(video.currentTime).toBe(2);
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('tracks active video time from the project clock', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview initialSceneIndex={1} />);
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(1200));

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('4200');
    expect(screen.getByText('00:04 / 00:09')).toBeInTheDocument();
  });

  it('does not reset active video time when the metadata probe reports the same duration', () => {
    const { container } = render(<StatefulPreview initialSceneIndex={1} />);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);
    video.currentTime = 2;

    loadVideoDuration(container, 'video', 4);

    expect(video.currentTime).toBe(2);
    video.currentTime = 0.5;

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '5000' } },
    );
    expect(video.currentTime).toBe(2);
  });

  it('seeks across repeated scenes after React reuses the ready video element', () => {
    const repeatedVideoScenes = [
      { ...scenes[1], subtitle: '첫 영상' },
      { ...scenes[1], subtitle: '두 번째 영상' },
    ];
    const { container } = render(
      <StatefulPreview
        initialSceneIndex={0}
        mediaList={[media[1]]}
        sceneList={repeatedVideoScenes}
      />,
    );
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '5000' } },
    );

    expect(screen.getByText('두 번째 영상')).toBeInTheDocument();
    expect(video.currentTime).toBe(1);
  });

  it('preserves paused video time when an unrelated subtitle edit rebuilds scenes', () => {
    const onSelectScene = vi.fn();
    const initialScenes = [scenes[0], scenes[1]];
    const { container, rerender } = render(
      <PreviewPanel
        media={media}
        narration={null}
        scenes={initialScenes}
        selectedSceneIndex={1}
        onSelectScene={onSelectScene}
      />,
    );
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);
    video.currentTime = 2;
    fireEvent.timeUpdate(video);

    rerender(
      <PreviewPanel
        media={media}
        narration={null}
        scenes={[initialScenes[0], { ...initialScenes[1], subtitle: '수정됨' }]}
        selectedSceneIndex={1}
        onSelectScene={onSelectScene}
      />,
    );

    expect(video.currentTime).toBe(2);
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '4500' } },
    );
    expect(video.currentTime).toBe(1.5);
  });

  it('waits for a newly selected video metadata before resuming a playing seek', () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '4000' } },
    );

    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    expect(play).not.toHaveBeenCalled();
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(1);
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();
  });

  it('resumes playing narration only after the requested seek completes', () => {
    const { container } = render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    audio.play = audioPlay;
    audio.pause = audioPause;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    audioPlay.mockClear();
    audioPause.mockClear();

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '2000' } },
    );

    expect(audio.currentTime).toBe(2);
    expect(audioPause).toHaveBeenCalledOnce();
    expect(audioPlay).not.toHaveBeenCalled();

    fireEvent.canPlay(audio);
    expect(audioPlay).not.toHaveBeenCalled();

    fireEvent.seeked(audio);
    expect(audioPlay).toHaveBeenCalledOnce();
    expect(container).toContainElement(audio);
  });

  it('keeps narration paused after a paused seek completes', () => {
    render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '1500' } },
    );
    fireEvent.seeked(audio);

    expect(audio.currentTime).toBe(1.5);
    expect(audioPlay).not.toHaveBeenCalled();
  });

  it('keeps the same narration element and source across a scene-changing seek', () => {
    render(<StatefulPreview narrationAsset={narration} />);
    const audioBefore = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const sourceBefore = audioBefore.getAttribute('src');
    const load = vi.fn();
    audioBefore.load = load;
    setMediaDuration(audioBefore, 10);
    fireEvent.loadedMetadata(audioBefore);

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '4000' } },
    );

    const audioAfter = screen.getByLabelText('내레이션') as HTMLAudioElement;
    expect(audioAfter).toBe(audioBefore);
    expect(audioAfter).toHaveAttribute('src', sourceBefore);
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores an old seeked event after a newer narration seek', () => {
    render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    audioPlay.mockClear();

    let actualTime = 0;
    const assignedTimes: number[] = [];
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => actualTime,
      set: (value: number) => assignedTimes.push(value),
    });
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });
    fireEvent.change(seekBar, { target: { value: '1000' } });
    fireEvent.change(seekBar, { target: { value: '2000' } });

    actualTime = 1;
    fireEvent.seeked(audio);
    expect(audioPlay).not.toHaveBeenCalled();
    expect(assignedTimes.at(-1)).toBe(2);

    actualTime = 2;
    fireEvent.seeked(audio);
    expect(audioPlay).toHaveBeenCalledOnce();
  });

  it('stops retrying an unseekable narration while visual playback continues', async () => {
    vi.useFakeTimers();
    render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    audioPlay.mockClear();

    const assignedTimes: number[] = [];
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: (value: number) => assignedTimes.push(value),
    });
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });
    fireEvent.change(seekBar, { target: { value: '2000' } });

    expect(assignedTimes).toEqual([2]);
    fireEvent.seeked(audio);
    expect(assignedTimes).toEqual([2, 2]);
    fireEvent.seeked(audio);
    expect(assignedTimes).toEqual([2, 2]);
    expect(audioPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '일시정지' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(Number(seekBar.getAttribute('value'))).toBeGreaterThan(2000);
  });

  it('abandons a pending video seek when manual navigation selects another scene', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview narrationAsset={narration} />);
    loadVideoDuration(container, 'video', 4);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '4000' } },
    );

    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    audioPlay.mockClear();
    fireEvent.seeked(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    expect(screen.getByRole('img', { name: 'last.png' })).toBeInTheDocument();
    expect(audioPlay).toHaveBeenCalledOnce();
  });

  it('ignores a superseded metadata-triggered play rejection after pausing', async () => {
    let rejectPlay: ((reason?: unknown) => void) | undefined;
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectPlay = reject;
          }),
      );
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '4000' } },
    );
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);
    expect(play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    await act(async () => rejectPlay?.(new Error('interrupted')));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('synchronizes narration, keeps short narration ended, and restores it after seeking back', () => {
    const { container } = render(<StatefulPreview narrationAsset={narration} />);
    loadVideoDuration(container, 'video', 4);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 4);
    fireEvent.loadedMetadata(audio);
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });

    fireEvent.change(seekBar, { target: { value: '5000' } });
    expect(audio.currentTime).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).not.toHaveBeenCalled();

    fireEvent.seeked(audio);
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    fireEvent.change(seekBar, { target: { value: '2000' } });
    expect(audio.currentTime).toBe(2);
    fireEvent.seeked(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).toHaveBeenCalledOnce();
  });

  it('waits for narration seek completion when returning from the project end', () => {
    const { container } = render(<StatefulPreview narrationAsset={narration} />);
    loadVideoDuration(container, 'video', 4);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    audio.play = audioPlay;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });

    fireEvent.change(seekBar, { target: { value: '9000' } });
    fireEvent.seeked(audio);
    expect(audio.currentTime).toBe(9);

    fireEvent.change(seekBar, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(audioPlay).not.toHaveBeenCalled();

    fireEvent.seeked(audio);
    expect(audio.currentTime).toBe(2);
    expect(audioPlay).toHaveBeenCalledOnce();
  });

  it('applies a pending narration seek after audio metadata loads', () => {
    render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '1500' } },
    );
    expect(audio.currentTime).toBe(0);

    setMediaDuration(audio, 2);
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(1.5);
  });

  it('retries a failed narration seek on canplay and resumes only after seeked', async () => {
    vi.useFakeTimers();
    render(
      <StatefulPreview
        narrationAsset={narration}
        mediaList={[media[0]]}
        sceneList={[scenes[0]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    audio.play = play;
    audio.pause = pause;
    setMediaDuration(audio, 3);
    fireEvent.loadedMetadata(audio);
    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    play.mockClear();

    let currentTime = 0;
    let attempts = 0;
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        attempts += 1;
        if (attempts === 1) {
          throw new DOMException('not seekable yet');
        }
        currentTime = value;
      },
    });

    fireEvent.change(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      { target: { value: '2000' } },
    );

    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledOnce();
    expect(currentTime).toBe(0);

    await act(async () => vi.advanceTimersByTimeAsync(400));
    fireEvent.canPlay(audio);

    expect(currentTime).toBe(2.4);
    expect(play).not.toHaveBeenCalled();
    fireEvent.seeked(audio);
    expect(play).toHaveBeenCalledOnce();
  });

  it('initializes narration at the start of a nonzero selected image scene', () => {
    render(
      <StatefulPreview
        narrationAsset={narration}
        initialSceneIndex={1}
        mediaList={[media[0], media[2]]}
        sceneList={[scenes[0], scenes[2]]}
      />,
    );
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);

    expect(audio.currentTime).toBe(3);
  });

  it('preserves active playback time when the final video metadata completes the timeline', () => {
    const secondVideo: MediaAsset = {
      id: 'second-video',
      kind: 'video',
      sourcePath: 'C:\\media\\second.mp4',
      fileName: 'second.mp4',
    };
    const secondVideoScene: Scene = {
      ...scenes[1],
      mediaId: secondVideo.id,
    };
    const { container } = render(
      <StatefulPreview
        narrationAsset={narration}
        initialSceneIndex={0}
        mediaList={[media[1], secondVideo]}
        sceneList={[scenes[1], secondVideoScene]}
      />,
    );
    const firstProbe = container.querySelector(
      'video[data-preview-metadata-id="video"]',
    ) as HTMLVideoElement;
    setMediaDuration(firstProbe, 4);
    fireEvent.loadedMetadata(firstProbe);
    const activeVideo = screen.getByLabelText(
      'clip.mp4 미리보기',
    ) as HTMLVideoElement;
    setMediaDuration(activeVideo, 4);
    fireEvent.loadedMetadata(activeVideo);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    setMediaDuration(audio, 10);
    fireEvent.loadedMetadata(audio);
    activeVideo.currentTime = 2;
    audio.currentTime = 2;

    loadVideoDuration(container, 'second-video', 5);

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('2000');
    expect(audio.currentTime).toBe(2);
  });

  it.each([
    ['playing', false],
    ['paused', true],
  ])(
    'preserves active image time when the final video metadata completes the timeline while %s',
    async (_state, pauseBeforeMetadata) => {
      vi.useFakeTimers();
      const { container } = render(
        <StatefulPreview
          narrationAsset={narration}
          mediaList={[media[0], media[1]]}
          sceneList={[scenes[0], scenes[1]]}
        />,
      );
      const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
      vi.spyOn(audio, 'play').mockResolvedValue();
      setMediaDuration(audio, 10);
      fireEvent.loadedMetadata(audio);
      fireEvent.click(screen.getByRole('button', { name: '재생' }));

      await act(async () => vi.advanceTimersByTimeAsync(1500));
      if (pauseBeforeMetadata) {
        fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
      }

      loadVideoDuration(container, 'video', 4);

      expect(
        screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
      ).toHaveValue('1500');
      expect(audio.currentTime).toBe(1.5);
    },
  );

  it('keeps the project seek bar at one hundred percent after the final image', async () => {
    vi.useFakeTimers();
    render(
      <StatefulPreview
        mediaList={[media[0]]}
        sceneList={[{ ...scenes[0], durationMs: 1000 }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    await act(async () => vi.advanceTimersByTimeAsync(1000));

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('1000');
    expect(screen.getByText('00:01 / 00:01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('keeps the project seek bar at one hundred percent after the final video', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(
      <StatefulPreview
        mediaList={[media[1]]}
        sceneList={[scenes[1]]}
      />,
    );
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(4000));

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('4000');
    expect(screen.getByText('00:04 / 00:04')).toBeInTheDocument();
  });

  it('resets project time when the project media and scenes are replaced', () => {
    const onSelectScene = vi.fn();
    const { container, rerender } = render(
      <PreviewPanel
        media={[media[1]]}
        narration={null}
        scenes={[scenes[1]]}
        selectedSceneIndex={0}
        onSelectScene={onSelectScene}
      />,
    );
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);
    video.currentTime = 2;
    fireEvent.timeUpdate(video);

    rerender(
      <PreviewPanel
        media={[media[0]]}
        narration={null}
        scenes={[scenes[0]]}
        selectedSceneIndex={0}
        onSelectScene={onSelectScene}
      />,
    );

    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });
    expect(seekBar).toHaveValue('0');
    expect(seekBar).toHaveAttribute('max', '3000');
  });

  it('guides an empty project to add an image or video', () => {
    render(
      <PreviewPanel
        media={[]}
        narration={null}
        scenes={[]}
        selectedSceneIndex={null}
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
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toBeDisabled();
    expect(screen.getByText('00:00 / 00:00')).toBeInTheDocument();
  });

  it('guides a narration-only project to add an image or video', () => {
    render(
      <PreviewPanel
        media={[]}
        narration={narration}
        scenes={[]}
        selectedSceneIndex={null}
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
        selectedSceneIndex={99}
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
        selectedSceneIndex={1}
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
    render(<StatefulPreview initialSceneIndex={1} />);

    const subtitle = screen.getByText('영상 자막');
    expect(subtitle.style.fontSize).toBe(`${(48 / 1080) * 100}cqw`);
    expect(subtitle.style.top).toBe('50%');
    expect(subtitle.style.transform).toBe('translateY(-50%)');
  });

  it('previews and navigates scenes with the same media independently by index', () => {
    const duplicateScenes: Scene[] = [
      { ...scenes[0], subtitle: '원본 자막' },
      {
        ...scenes[0],
        subtitle: '복제 자막',
        subtitlePosition: 'top',
        subtitleSize: 'large',
      },
    ];
    render(
      <StatefulPreview sceneList={duplicateScenes} initialSceneIndex={1} />,
    );

    const duplicateSubtitle = screen.getByText('복제 자막');
    expect(duplicateSubtitle.style.top).toBe(`${(150 / 1920) * 100}%`);
    expect(duplicateSubtitle.style.fontSize).toBe(`${(80 / 1080) * 100}cqw`);

    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(screen.getByText('원본 자막')).toBeInTheDocument();
  });

  it('advances image playback between consecutive scenes with the same media', async () => {
    vi.useFakeTimers();
    const duplicateScenes: Scene[] = [
      { ...scenes[0], durationMs: 1000, subtitle: '원본 이미지' },
      { ...scenes[0], durationMs: 1500, subtitle: '복제 이미지' },
    ];
    render(<StatefulPreview sceneList={duplicateScenes} />);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('복제 이미지')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument();
  });

  it('advances at the project-clock boundary between consecutive video scenes', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const duplicateVideos: Scene[] = [
      { ...scenes[1], subtitle: '원본 영상' },
      { ...scenes[1], subtitle: '복제 영상' },
    ];
    const { container } = render(<StatefulPreview sceneList={duplicateVideos} />);
    loadVideoDuration(container, 'video', 4);
    const video = screen.getByLabelText('clip.mp4 미리보기') as HTMLVideoElement;
    setMediaDuration(video, 4);
    fireEvent.loadedMetadata(video);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => vi.advanceTimersByTimeAsync(4000));

    expect(screen.getByText('복제 영상')).toBeInTheDocument();
  });

  it('moves between image and video scenes with previous and next', () => {
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);

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
    const { container } = render(<StatefulPreview />);
    loadVideoDuration(container, 'video', 4);
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    fireEvent.click(screen.getByRole('button', { name: '재생' }));

    await act(async () => vi.advanceTimersByTimeAsync(4000));

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
    await act(async () => Promise.resolve());
    expect(audio.currentTime).toBe(0);
    expect(play).toHaveBeenCalledOnce();

    audio.currentTime = 1.25;
    fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(1.25);

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => Promise.resolve());
    expect(play).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(1.25);
  });

  it('keeps narration playing across scenes and pauses it after the final scene', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<StatefulPreview narrationAsset={narration} />);
    const audio = screen.getByLabelText('내레이션') as HTMLAudioElement;
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    audio.play = audioPlay;
    audio.pause = audioPause;

    fireEvent.click(screen.getByRole('button', { name: '재생' }));
    await act(async () => Promise.resolve());
    expect(audioPlay).toHaveBeenCalledOnce();
    loadVideoDuration(container, 'video', 4);
    audioPause.mockClear();
    audio.currentTime = 0.75;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    expect(audioPlay).toHaveBeenCalledOnce();
    expect(audioPause).not.toHaveBeenCalled();
    expect(audio.currentTime).toBe(0.75);

    await act(async () => vi.advanceTimersByTimeAsync(4000));
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
      <StatefulPreview narrationAsset={narration} initialSceneIndex={1} />,
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
        selectedSceneIndex={0}
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
      <StatefulPreview narrationAsset={narration} initialSceneIndex={1} />,
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

  it('clears a load error and uses the new source after media is reconnected', async () => {
    const { rerender } = render(
      <PreviewPanel
        media={[media[0]]}
        narration={null}
        scenes={[scenes[0]]}
        selectedSceneIndex={0}
        onSelectScene={vi.fn()}
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'first image.jpg' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '미디어를 불러오지 못했습니다.',
    );

    const restoredAsset: MediaAsset = {
      ...media[0],
      sourcePath: 'D:\\restored\\renamed.png',
      fileName: 'renamed.png',
    };
    rerender(
      <PreviewPanel
        media={[restoredAsset]}
        narration={null}
        scenes={[scenes[0]]}
        selectedSceneIndex={0}
        onSelectScene={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('img', { name: 'renamed.png' }),
    ).toHaveAttribute('src', createMediaUrl(restoredAsset.sourcePath));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('invalidates a video duration when relink changes its source path', () => {
    const onSelectScene = vi.fn();
    const { container, rerender } = render(
      <PreviewPanel
        media={[media[1]]}
        narration={null}
        scenes={[scenes[1]]}
        selectedSceneIndex={0}
        onSelectScene={onSelectScene}
      />,
    );
    loadVideoDuration(container, 'video', 4);
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toBeEnabled();

    const relinkedVideo: MediaAsset = {
      ...media[1],
      sourcePath: 'D:\\restored\\clip.mp4',
    };
    rerender(
      <PreviewPanel
        media={[relinkedVideo]}
        narration={null}
        scenes={[scenes[1]]}
        selectedSceneIndex={0}
        onSelectScene={onSelectScene}
      />,
    );

    const seekBar = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });
    expect(seekBar).toBeDisabled();
    const metadataVideo = container.querySelector(
      'video[data-preview-metadata-id="video"]',
    ) as HTMLVideoElement;
    expect(metadataVideo).toHaveAttribute(
      'src',
      createMediaUrl(relinkedVideo.sourcePath),
    );

    setMediaDuration(metadataVideo, 6);
    fireEvent.loadedMetadata(metadataVideo);
    expect(seekBar).toHaveAttribute('max', '6000');
    expect(seekBar).toBeEnabled();
  });
});
