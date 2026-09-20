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
  { mediaId: 'photo-id', durationMs: 3000 },
  { mediaId: 'video-id', durationMs: null },
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
        onMoveScene={vi.fn()}
        onDeleteScene={vi.fn()}
        onUpdateSceneDuration={vi.fn()}
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
    expect(within(items[0]).getByRole('button', { name: '위' })).toBeDisabled();
    expect(within(items[0]).getByRole('button', { name: '아래' })).toBeEnabled();

    expect(within(items[1]).getByText('2')).toBeInTheDocument();
    expect(within(items[1]).getByText('clip.mp4')).toBeInTheDocument();
    expect(within(items[1]).getByText('영상')).toBeInTheDocument();
    expect(within(items[1]).getByText('길이 미확인')).toBeInTheDocument();
    expect(within(items[1]).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: '아래' })).toBeDisabled();
  });

  it('forwards move, delete, and image duration changes', async () => {
    const user = userEvent.setup();
    const onMoveScene = vi.fn();
    const onDeleteScene = vi.fn();
    const onUpdateSceneDuration = vi.fn();
    render(
      <TimelineShell
        media={media}
        scenes={scenes}
        onMoveScene={onMoveScene}
        onDeleteScene={onDeleteScene}
        onUpdateSceneDuration={onUpdateSceneDuration}
      />,
    );

    const items = screen.getAllByRole('listitem');
    await user.click(within(items[1]).getByRole('button', { name: '위' }));
    await user.click(within(items[0]).getByRole('button', { name: '삭제' }));
    fireEvent.change(within(items[0]).getByRole('spinbutton'), {
      target: { value: '4.5' },
    });

    expect(onMoveScene).toHaveBeenCalledWith('video-id', 'up');
    expect(onDeleteScene).toHaveBeenCalledWith('photo-id');
    expect(onUpdateSceneDuration).toHaveBeenCalledWith('photo-id', 4500);
  });
});
