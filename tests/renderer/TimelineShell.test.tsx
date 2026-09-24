import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelineShell } from '../../src/renderer/components/TimelineShell';
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
  { mediaId: 'photo-id', durationMs: 3000, subtitle: '사진 자막' },
  { mediaId: 'video-id', durationMs: null, subtitle: '' },
];

afterEach(() => {
  cleanup();
});

describe('TimelineShell', () => {
  it('renders ordered scenes with boundary controls and kind-specific duration UI', () => {
    render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="photo-id"
        onSelectScene={vi.fn()}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );

    const region = screen.getByRole('region', { name: '장면 목록' });
    const items = within(region).getAllByRole('listitem');

    expect(within(items[0]).getByText('1')).toBeInTheDocument();
    expect(within(items[0]).getByText('photo.jpg')).toBeInTheDocument();
    expect(within(items[0]).getByText('이미지')).toBeInTheDocument();
    expect(within(items[0]).getByRole('spinbutton')).toHaveValue(3);
    expect(within(items[0]).getByRole('spinbutton')).toHaveAttribute(
      'step',
      '0.001',
    );
    expect(
      within(items[0]).getByRole('textbox', { name: '1번 장면 자막' }),
    ).toHaveValue('사진 자막');
    expect(within(items[0]).getByRole('button', { name: '위' })).toBeDisabled();
    expect(within(items[0]).getByRole('button', { name: '아래' })).toBeEnabled();

    expect(within(items[1]).getByText('2')).toBeInTheDocument();
    expect(within(items[1]).getByText('clip.mp4')).toBeInTheDocument();
    expect(within(items[1]).getByText('영상')).toBeInTheDocument();
    expect(within(items[1]).getByText('길이 확인 중...')).toBeInTheDocument();
    expect(within(items[1]).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: '아래' })).toBeDisabled();
  });

  it('renders image and video thumbnails from combark-media URLs', () => {
    const { container } = render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="photo-id"
        onSelectScene={vi.fn()}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );

    const image = container.querySelector('img');
    const video = container.querySelector('video');

    expect(image).toHaveAttribute(
      'src',
      'combark-media://local/?path=C%3A%5Cmedia%5Cphoto.jpg',
    );
    expect(video).toHaveAttribute(
      'src',
      'combark-media://local/?path=C%3A%5Cmedia%5Cclip.mp4',
    );
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).not.toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveProperty('playsInline', true);
  });

  it.each([
    [23, '00:23'],
    [72, '01:12'],
  ])('shows a %s second video duration as %s', (duration, expected) => {
    const { container } = render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="video-id"
        onSelectScene={vi.fn()}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: duration });

    fireEvent.loadedMetadata(video);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each([0, Number.POSITIVE_INFINITY, Number.NaN])(
    'shows an unavailable duration for invalid metadata duration %s',
    (duration) => {
      const { container } = render(
        <TimelineShell
          media={media}
          scenes={scenes}
          selectedMediaId="video-id"
          onSelectScene={vi.fn()}
          onMoveScene={vi.fn()}
          onDeleteScene={vi.fn()}
          onUpdateSceneDuration={vi.fn()}
          onUpdateSceneSubtitle={vi.fn()}
        />,
      );
      const video = container.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(video, 'duration', { configurable: true, value: duration });

      fireEvent.loadedMetadata(video);

      expect(screen.getByText('길이 확인 불가')).toBeInTheDocument();
    },
  );

  it('shows an unavailable duration when video metadata loading fails', () => {
    const { container } = render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="video-id"
        onSelectScene={vi.fn()}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );

    fireEvent.error(container.querySelector('video') as HTMLVideoElement);

    expect(screen.getByText('길이 확인 불가')).toBeInTheDocument();
  });

  it('keeps a valid duration when seeking the thumbnail frame fails', () => {
    const { container } = render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="video-id"
        onSelectScene={vi.fn()}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 23 });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      set: () => {
        throw new Error('seek failed');
      },
    });

    fireEvent.loadedMetadata(video);

    expect(screen.getByText('00:23')).toBeInTheDocument();
  });

  it('forwards move, file removal, duration, and subtitle changes', async () => {
    const user = userEvent.setup();
    const onMoveScene = vi.fn();
    const onDeleteScene = vi.fn();
    const onUpdateSceneDuration = vi.fn();
    const onUpdateSceneSubtitle = vi.fn();
    render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="photo-id"
        onSelectScene={vi.fn()}
        onMoveScene={onMoveScene}
        onDeleteScene={onDeleteScene}
        onUpdateSceneDuration={onUpdateSceneDuration}
        onUpdateSceneSubtitle={onUpdateSceneSubtitle}
      />,
    );

    const items = screen.getAllByRole('listitem');
    await user.click(within(items[1]).getByRole('button', { name: '위' }));
    await user.click(
      within(items[0]).getByRole('button', { name: '파일 제거' }),
    );
    fireEvent.change(within(items[0]).getByRole('spinbutton'), {
      target: { value: '4.5' },
    });
    fireEvent.change(
      within(items[0]).getByRole('textbox', { name: '1번 장면 자막' }),
      { target: { value: '변경 자막' } },
    );

    expect(onMoveScene).toHaveBeenCalledWith('video-id', 'up');
    expect(onDeleteScene).toHaveBeenCalledWith('photo-id');
    expect(onUpdateSceneDuration).toHaveBeenCalledWith('photo-id', 4500);
    expect(onUpdateSceneSubtitle).toHaveBeenLastCalledWith(
      'photo-id',
      '변경 자막',
    );
  });

  it('marks the selected scene and forwards scene selection clicks', async () => {
    const user = userEvent.setup();
    const onSelectScene = vi.fn();
    render(
      <TimelineShell
        media={media}
        scenes={scenes}
        selectedMediaId="photo-id"
        onSelectScene={onSelectScene}
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
        onUpdateSceneSubtitle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: '1번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      screen.getByRole('button', { name: '2번 장면 선택' }),
    );

    expect(onSelectScene).toHaveBeenCalledWith('video-id');
  });
});
