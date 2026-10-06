import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MultiTrackTimeline } from '../../src/renderer/components/MultiTrackTimeline';
import type { TimelinePlaybackSnapshot } from '../../src/renderer/project/timelineLayout';
import type { MediaAsset, Scene } from '../../src/shared/project/types';

const media: MediaAsset[] = [
  {
    id: 'image',
    kind: 'image',
    sourcePath: 'C:\\media\\image.png',
    fileName: 'image.png',
  },
  {
    id: 'video',
    kind: 'video',
    sourcePath: 'C:\\media\\video.mp4',
    fileName: 'video.mp4',
  },
];

const scenes: Scene[] = [
  {
    mediaId: 'image',
    durationMs: 3000,
    subtitle: '첫 자막',
    subtitlePosition: 'bottom',
    subtitleSize: 'medium',
  },
  {
    mediaId: 'video',
    durationMs: null,
    subtitle: '',
    subtitlePosition: 'bottom',
    subtitleSize: 'medium',
  },
];

const playback: TimelinePlaybackSnapshot = {
  currentTimeMs: 3500,
  totalDurationMs: 7000,
  ready: true,
  sceneTimings: [
    { sceneIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000 },
    { sceneIndex: 1, startMs: 3000, endMs: 7000, durationMs: 4000 },
  ],
  narrationDurationMs: 5000,
};

function renderTimeline(
  overrides: Partial<ComponentProps<typeof MultiTrackTimeline>> = {},
) {
  const props: ComponentProps<typeof MultiTrackTimeline> = {
    media,
    scenes,
    narration: {
      sourcePath: 'C:\\audio\\voice.mp3',
      fileName: 'voice.mp3',
    },
    selectedSceneIndex: 1,
    playback,
    onSelectScene: vi.fn(),
    onAddMedia: vi.fn(),
    onDeleteScene: vi.fn(),
    onDuplicateScene: vi.fn(),
    onMoveScene: vi.fn(),
    onMoveSceneTo: vi.fn(),
    onUpdateSceneDuration: vi.fn(),
    ...overrides,
  };
  return { ...render(<MultiTrackTimeline {...props} />), props };
}

function setScrollGeometry(
  element: HTMLElement,
  { clientWidth, scrollWidth }: { clientWidth: number; scrollWidth: number },
): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
}

afterEach(cleanup);

describe('MultiTrackTimeline', () => {
  it('renders proportional scene and subtitle blocks with the preview playhead', () => {
    renderTimeline();

    expect(screen.getByRole('button', { name: '1번 장면 image.png' }).closest('.timeline-clip')).toHaveStyle({
      left: '0px',
      width: '180px',
    });
    expect(screen.getByRole('button', { name: '2번 장면 video.mp4' }).closest('.timeline-clip')).toHaveStyle({
      left: '180px',
      width: '240px',
    });
    expect(screen.getByRole('button', { name: '1번 장면 자막' })).toHaveTextContent(
      '첫 자막',
    );
    expect(screen.queryByRole('button', { name: '2번 장면 자막' })).toBeNull();
    expect(screen.getByLabelText('재생 위치선')).toHaveStyle({ left: '210px' });
  });

  it('selects a scene from either its media block or subtitle block', () => {
    const onSelectScene = vi.fn();
    renderTimeline({ onSelectScene });

    fireEvent.click(screen.getByRole('button', { name: '1번 장면 image.png' }));
    fireEvent.click(screen.getByRole('button', { name: '1번 장면 자막' }));

    expect(onSelectScene).toHaveBeenNthCalledWith(1, 0);
    expect(onSelectScene).toHaveBeenNthCalledWith(2, 0);
    expect(screen.getByRole('button', { name: '2번 장면 video.mp4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('forwards existing add, delete, duplicate, and previous/next move operations', () => {
    const onAddMedia = vi.fn();
    const onDeleteScene = vi.fn();
    const onDuplicateScene = vi.fn();
    const onMoveScene = vi.fn();
    renderTimeline({
      onAddMedia,
      onDeleteScene,
      onDuplicateScene,
      onMoveScene,
    });

    fireEvent.click(screen.getByRole('button', { name: '미디어 추가' }));
    fireEvent.click(screen.getByRole('button', { name: '선택 장면 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '선택 장면 복제' }));
    fireEvent.click(screen.getByRole('button', { name: '선택 장면 이전으로 이동' }));

    expect(onAddMedia).toHaveBeenCalledOnce();
    expect(onDeleteScene).toHaveBeenCalledWith(1);
    expect(onDuplicateScene).toHaveBeenCalledWith(1);
    expect(onMoveScene).toHaveBeenCalledWith(1, 'up');
    expect(
      screen.getByRole('button', { name: '선택 장면 다음으로 이동' }),
    ).toBeDisabled();
  });

  it('shows narration length and disabled future audio tracks', () => {
    renderTimeline();

    expect(screen.getByText('voice.mp3')).toHaveStyle({ width: '300px' });
    expect(screen.getByLabelText('효과음 트랙')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByLabelText('음악 트랙')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getAllByText('향후 지원')).toHaveLength(2);
    expect(screen.getByLabelText('사진/영상 트랙')).toBeInTheDocument();
    expect(screen.getByLabelText('자막 트랙')).toBeInTheDocument();
    expect(screen.getByLabelText('나레이션 트랙')).toBeInTheDocument();
    expect(screen.getByLabelText('효과음 트랙')).toBeInTheDocument();
    expect(screen.getByLabelText('음악 트랙')).toBeInTheDocument();
  });

  it('shows a loading state instead of partial geometry before metadata is ready', () => {
    renderTimeline({
      playback: {
        currentTimeMs: 0,
        totalDurationMs: 0,
        ready: false,
        sceneTimings: [],
        narrationDurationMs: undefined,
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('타임라인 준비 중');
    expect(screen.queryByRole('button', { name: '1번 장면 image.png' })).toBeNull();
  });

  it('keeps scene selection available when video duration cannot be loaded', () => {
    const onSelectScene = vi.fn();
    renderTimeline({
      onSelectScene,
      playback: {
        currentTimeMs: 0,
        totalDurationMs: 0,
        ready: false,
        durationUnavailable: true,
        sceneTimings: [],
        narrationDurationMs: undefined,
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      '타임라인 길이를 확인할 수 없습니다',
    );
    fireEvent.click(screen.getByRole('button', { name: '2번 장면 video.mp4' }));
    expect(onSelectScene).toHaveBeenCalledWith(1);
    expect(screen.queryByLabelText('시간 눈금')).toBeNull();
  });

  it('distinguishes a failed narration duration from loading', () => {
    renderTimeline({
      playback: { ...playback, narrationDurationMs: null },
    });

    expect(screen.getByText('나레이션 길이 확인 불가')).toBeInTheDocument();
    expect(screen.queryByText('나레이션 길이 확인 중...')).toBeNull();
  });

  it('auto-follows only after the playhead crosses the right safe boundary', () => {
    const { container, props, rerender } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    setScrollGeometry(scroll, { clientWidth: 400, scrollWidth: 720 });
    scroll.scrollLeft = 0;

    rerender(
      <MultiTrackTimeline
        {...props}
        playback={{ ...playback, currentTimeMs: 3600 }}
      />,
    );
    expect(scroll.scrollLeft).toBe(0);

    rerender(
      <MultiTrackTimeline
        {...props}
        playback={{ ...playback, currentTimeMs: 6000 }}
      />,
    );
    expect(scroll.scrollLeft).toBe(72);
  });

  it('follows a backward seek and clamps scrolling to the canvas bounds', () => {
    const { container, props, rerender } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    setScrollGeometry(scroll, { clientWidth: 400, scrollWidth: 720 });
    scroll.scrollLeft = 250;

    rerender(
      <MultiTrackTimeline
        {...props}
        playback={{ ...playback, currentTimeMs: 4000 }}
      />,
    );
    expect(scroll.scrollLeft).toBe(140);

    scroll.scrollLeft = 250;
    rerender(
      <MultiTrackTimeline
        {...props}
        playback={{ ...playback, currentTimeMs: 0 }}
      />,
    );
    expect(scroll.scrollLeft).toBe(0);
  });

  it('preserves paused manual scrolling while the project time is unchanged', () => {
    const { container, props, rerender } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    setScrollGeometry(scroll, { clientWidth: 400, scrollWidth: 720 });
    scroll.scrollLeft = 175;

    rerender(
      <MultiTrackTimeline {...props} selectedSceneIndex={0} />,
    );

    expect(scroll.scrollLeft).toBe(175);
  });

  it('reorders a scene across multiple indexes and suppresses the following click', () => {
    const fourMedia: MediaAsset[] = Array.from({ length: 4 }, (_, index) => ({
      id: `image-${index}`,
      kind: 'image' as const,
      sourcePath: `C:\\media\\image-${index}.png`,
      fileName: `image-${index}.png`,
    }));
    const fourScenes: Scene[] = fourMedia.map((asset) => ({
      mediaId: asset.id,
      durationMs: 1000,
      subtitle: '',
      subtitlePosition: 'bottom',
      subtitleSize: 'medium',
    }));
    const onMoveSceneTo = vi.fn();
    const onSelectScene = vi.fn();
    const { container } = renderTimeline({
      media: fourMedia,
      scenes: fourScenes,
      selectedSceneIndex: 2,
      playback: {
        ...playback,
        currentTimeMs: 0,
        totalDurationMs: 4000,
        sceneTimings: fourScenes.map((_, sceneIndex) => ({
          sceneIndex,
          startMs: sceneIndex * 1000,
          endMs: (sceneIndex + 1) * 1000,
          durationMs: 1000,
        })),
      },
      onMoveSceneTo,
      onSelectScene,
    });
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 400, top: 0, bottom: 200,
      width: 400, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    const clip = screen.getByRole('button', { name: '3번 장면 image-2.png' });

    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 150 });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 70 });
    expect(container.querySelector('.timeline-drop-indicator')).toHaveStyle({
      left: '60px',
    });
    fireEvent.pointerUp(clip, { pointerId: 1, clientX: 70 });
    fireEvent.click(clip);

    expect(onMoveSceneTo).toHaveBeenCalledWith(2, 1);
    expect(onSelectScene).toHaveBeenCalledTimes(1);
    expect(onSelectScene).toHaveBeenCalledWith(2);
  });

  it('cancels reorder on Escape or pointer cancellation', () => {
    const onMoveSceneTo = vi.fn();
    renderTimeline({ onMoveSceneTo });
    const clip = screen.getByRole('button', { name: '1번 장면 image.png' });

    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 20 });
    fireEvent.pointerMove(clip, { pointerId: 1, clientX: 100 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerDown(clip, { pointerId: 2, clientX: 20 });
    fireEvent.pointerMove(clip, { pointerId: 2, clientX: 100 });
    fireEvent.pointerCancel(clip, { pointerId: 2 });

    expect(onMoveSceneTo).not.toHaveBeenCalled();
  });

  it('drafts image resizing, snaps and clamps it, then commits once', () => {
    const onUpdateSceneDuration = vi.fn();
    const { container } = renderTimeline({ onUpdateSceneDuration });
    const handle = screen.getByRole('button', { name: '1번 장면 길이 조절' });
    const imageClip = screen.getByRole('button', {
      name: '1번 장면 image.png',
    }).closest('.timeline-clip') as HTMLElement;
    const videoClip = screen.getByRole('button', {
      name: '2번 장면 video.mp4',
    }).closest('.timeline-clip') as HTMLElement;

    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 180 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: -320 });
    expect(imageClip).toHaveStyle({ width: '30px' });
    expect(videoClip).toHaveStyle({ left: '30px' });
    expect(container.querySelector('.timeline-resize-duration')).toHaveTextContent('0.5초');
    expect(onUpdateSceneDuration).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: -320 });

    expect(onUpdateSceneDuration).toHaveBeenCalledOnce();
    expect(onUpdateSceneDuration).toHaveBeenCalledWith(0, 500);
  });

  it('cancels an image resize on Escape and never offers video resize', () => {
    const onUpdateSceneDuration = vi.fn();
    renderTimeline({ onUpdateSceneDuration });
    const handle = screen.getByRole('button', { name: '1번 장면 길이 조절' });

    fireEvent.pointerDown(handle, { pointerId: 4, clientX: 180 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 240 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onUpdateSceneDuration).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '2번 장면 길이 조절' })).toBeNull();
  });

  it('suspends auto-follow during interaction and resumes on the next playback update', () => {
    const { container, props, rerender } = renderTimeline();
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    setScrollGeometry(scroll, { clientWidth: 400, scrollWidth: 720 });
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 400, top: 0, bottom: 200,
      width: 400, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    const clip = screen.getByRole('button', { name: '1번 장면 image.png' });

    fireEvent.pointerDown(clip, { pointerId: 5, clientX: 20 });
    fireEvent.pointerMove(clip, { pointerId: 5, clientX: 80 });
    rerender(
      <MultiTrackTimeline {...props} playback={{ ...playback, currentTimeMs: 6000 }} />,
    );
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.pointerUp(clip, { pointerId: 5, clientX: 80 });
    rerender(
      <MultiTrackTimeline {...props} playback={{ ...playback, currentTimeMs: 6100 }} />,
    );
    expect(scroll.scrollLeft).toBeGreaterThan(0);
  });
});
