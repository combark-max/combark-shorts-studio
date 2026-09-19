import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';

beforeEach(() => {
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: {
      getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
    },
  });
});

describe('App', () => {
  it('renders the approved editor shell', async () => {
    render(<App />);

    expect(screen.getByText('Combark Shorts Studio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 프로젝트' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '쇼츠 자동 만들기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'YouTube Shorts로 내보내기' })).toBeInTheDocument();

    expect(screen.getByText('미디어')).toBeInTheDocument();
    expect(screen.getByText('미리보기')).toBeInTheDocument();
    expect(screen.getByText('속성')).toBeInTheDocument();

    expect(screen.getByText('비디오 / 사진')).toBeInTheDocument();
    expect(screen.getByText('자막')).toBeInTheDocument();
    expect(screen.getByText('배경음악')).toBeInTheDocument();
    expect(screen.getByText('내레이션')).toBeInTheDocument();

    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
  });
});