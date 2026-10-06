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
    ...overrides,
  };
  return { ...render(<MultiTrackTimeline {...props} />), props };
}

afterEach(cleanup);

describe('MultiTrackTimeline', () => {
  it('renders proportional scene and subtitle blocks with the preview playhead', () => {
    renderTimeline();

    expect(screen.getByRole('button', { name: '1번 장면 image.png' })).toHaveStyle({
      left: '0px',
      width: '180px',
    });
    expect(screen.getByRole('button', { name: '2번 장면 video.mp4' })).toHaveStyle({
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
});
