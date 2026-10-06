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
  it('shows a media launcher and source-attention badge while the drawer is closed', () => {
    const { props } = renderSidebar({ collapsed: true });

    expect(
      screen.getByRole('button', { name: '미디어 열기' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName(
      '원본 파일 확인 필요',
    );

    expect(screen.queryByRole('complementary', { name: '미디어' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '미디어 열기' }));

    expect(props.onToggleCollapsed).toHaveBeenCalledWith(false);
  });

  it('restores all existing media and narration controls when expanded', () => {
    const { props } = renderSidebar();

    expect(screen.getByRole('complementary', { name: '미디어' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '미디어 닫기' }),
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
});
