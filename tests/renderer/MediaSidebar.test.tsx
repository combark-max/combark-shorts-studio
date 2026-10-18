import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaSidebar } from '../../src/renderer/components/MediaSidebar';

function renderSidebar(
  overrides: Partial<ComponentProps<typeof MediaSidebar>> = {},
) {
  const props: ComponentProps<typeof MediaSidebar> = {
    media: [
      {
        id: 'missing-image',
        kind: 'image',
        sourcePath: 'C:\\media\\missing.jpg',
        fileName: 'missing.jpg',
      },
    ],
    narration: {
      sourcePath: 'C:\\audio\\voice.mp3',
      fileName: 'voice.mp3',
    },
    missingMediaIds: ['missing-image'],
    narrationMissing: true,
    sourceCheckFailed: false,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onAddMedia: vi.fn(),
    onRelinkMedia: vi.fn(),
    onRelinkNarration: vi.fn(),
    onRemoveNarration: vi.fn(),
    onSelectNarration: vi.fn(),
    ...overrides,
  };
  return { ...render(<MediaSidebar {...props} />), props };
}

afterEach(cleanup);

describe('MediaSidebar', () => {
  it('keeps a collapsed media dock mounted with source attention visible', () => {
    const { container, props, rerender } = renderSidebar({ collapsed: true });
    const dock = screen.getByRole('complementary', { name: '미디어' });
    const content = container.querySelector('#media-dock-content');

    expect(
      screen.getByRole('button', { name: '미디어 펼치기' }),
    ).toBeInTheDocument();
    expect(dock).toHaveClass('media-sidebar-collapsed');
    expect(content).toHaveAttribute('hidden');
    expect(screen.getByRole('status')).toHaveAccessibleName(
      '원본 파일 확인 필요',
    );
    expect(container.querySelector('.media-drawer-backdrop')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '미디어 펼치기' }));

    expect(props.onToggleCollapsed).toHaveBeenCalledWith(false);

    rerender(<MediaSidebar {...props} collapsed={false} />);
    expect(screen.getByRole('complementary', { name: '미디어' })).toBe(dock);
    expect(container.querySelector('#media-dock-content')).toBe(content);
    expect(content).not.toHaveAttribute('hidden');
    expect(screen.getByText('missing.jpg')).toBeInTheDocument();
  });

  it('restores all existing media and narration controls when expanded', () => {
    const { container, props } = renderSidebar();

    expect(screen.getByRole('complementary', { name: '미디어' })).toBeInTheDocument();
    expect(container.querySelector('.media-drawer-backdrop')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: '미디어 접기' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'missing.jpg 파일 다시 찾기' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'voice.mp3 파일 다시 찾기' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '내레이션 제거' }));

    expect(props.onToggleCollapsed).toHaveBeenCalledWith(true);
    expect(props.onRelinkMedia).toHaveBeenCalledWith('missing-image');
    expect(props.onRelinkNarration).toHaveBeenCalledOnce();
    expect(props.onRemoveNarration).toHaveBeenCalledOnce();
    expect(screen.getByText('전환효과')).toBeInTheDocument();
  });

  it('preserves empty and source-check error states inside the dock', () => {
    renderSidebar({
      media: [],
      narration: null,
      missingMediaIds: [],
      narrationMissing: false,
      sourceCheckFailed: true,
    });

    expect(screen.getByText('추가된 미디어가 없습니다.')).toBeInTheDocument();
    expect(
      screen.getByText('원본 파일 상태를 확인하지 못했습니다.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 선택' }),
    ).toBeInTheDocument();
  });
});
