import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelineShell } from '../../src/renderer/components/TimelineShell';
import type { TimelinePlaybackSnapshot } from '../../src/renderer/project/timelineLayout';
import type { MediaAsset, Scene } from '../../src/shared/project/types';

const media: MediaAsset[] = [
  {
    id: 'photo-id',
    kind: 'image',
    sourcePath: 'C:\\media\\photo.jpg',
    fileName: 'photo.jpg',
  },
  {
    id: 'video-id',
    kind: 'video',
    sourcePath: 'C:\\media\\clip.mp4',
    fileName: 'clip.mp4',
  },
];

const scenes: Scene[] = [
  {
    mediaId: 'photo-id',
    durationMs: 3000,
    subtitle: '사진 자막',
    subtitlePosition: 'bottom',
    subtitleSize: 'medium',
  },
  {
    mediaId: 'video-id',
    durationMs: null,
    subtitle: '',
    subtitlePosition: 'bottom',
    subtitleSize: 'medium',
  },
];

const playback: TimelinePlaybackSnapshot = {
  currentTimeMs: 0,
  totalDurationMs: 7000,
  ready: true,
  sceneTimings: [
    { sceneIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000 },
    { sceneIndex: 1, startMs: 3000, endMs: 7000, durationMs: 4000 },
  ],
  narrationDurationMs: undefined,
};

function renderTimelineShell(
  overrides: Partial<ComponentProps<typeof TimelineShell>> = {},
) {
  const props: ComponentProps<typeof TimelineShell> = {
    media,
    narration: null,
    scenes,
    selectedSceneIndex: 0,
    playback,
    onSelectScene: vi.fn(),
    onAddMedia: vi.fn(),
    onMoveScene: vi.fn(),
    onDeleteScene: vi.fn(),
    onDuplicateScene: vi.fn(),
    onUpdateSceneDuration: vi.fn(),
    onUpdateSceneSubtitle: vi.fn(),
    onUpdateSceneSubtitlePosition: vi.fn(),
    onUpdateSceneSubtitleSize: vi.fn(),
    ...overrides,
  };
  return { ...render(<TimelineShell {...props} />), props };
}

afterEach(cleanup);

describe('TimelineShell', () => {
  it('keeps the selected scene detail collapsed until requested', () => {
    renderTimelineShell();

    expect(screen.getByRole('region', { name: '타임라인' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '선택 장면 상세 펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('spinbutton', { name: '이미지 표시시간 (초)' }),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: '이미지 표시시간 (초)' }),
    ).toHaveValue(3);
    expect(screen.getByRole('textbox', { name: '선택 장면 자막' })).toHaveValue(
      '사진 자막',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('edits the selected image duration and existing subtitle fields', async () => {
    const user = userEvent.setup();
    const onUpdateSceneDuration = vi.fn();
    const onUpdateSceneSubtitle = vi.fn();
    const onUpdateSceneSubtitlePosition = vi.fn();
    const onUpdateSceneSubtitleSize = vi.fn();
    renderTimelineShell({
      onUpdateSceneDuration,
      onUpdateSceneSubtitle,
      onUpdateSceneSubtitlePosition,
      onUpdateSceneSubtitleSize,
    });
    fireEvent.click(
      screen.getByRole('button', { name: '선택 장면 상세 펼치기' }),
    );

    fireEvent.change(
      screen.getByRole('spinbutton', { name: '이미지 표시시간 (초)' }),
      { target: { value: '4.5' } },
    );
    fireEvent.change(screen.getByRole('textbox', { name: '선택 장면 자막' }), {
      target: { value: '변경 자막' },
    });
    await user.selectOptions(
      screen.getByRole('combobox', { name: '선택 장면 자막 위치' }),
      'top',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: '선택 장면 자막 크기' }),
      'large',
    );

    expect(onUpdateSceneDuration).toHaveBeenCalledWith(0, 4500);
    expect(onUpdateSceneSubtitle).toHaveBeenCalledWith(0, '변경 자막');
    expect(onUpdateSceneSubtitlePosition).toHaveBeenCalledWith(0, 'top');
    expect(onUpdateSceneSubtitleSize).toHaveBeenCalledWith(0, 'large');
  });

  it('uses preview timing for selected video information without loading metadata again', () => {
    const { container } = renderTimelineShell({ selectedSceneIndex: 1 });
    fireEvent.click(
      screen.getByRole('button', { name: '선택 장면 상세 펼치기' }),
    );

    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('장면 길이 00:04')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows no detail when the project has no selected scene', () => {
    renderTimelineShell({
      media: [],
      scenes: [],
      selectedSceneIndex: null,
      playback: {
        currentTimeMs: 0,
        totalDurationMs: 0,
        ready: true,
        sceneTimings: [],
        narrationDurationMs: undefined,
      },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '선택 장면 상세 펼치기' }),
    );

    expect(screen.getByText('선택된 장면이 없습니다.')).toBeInTheDocument();
  });
});
