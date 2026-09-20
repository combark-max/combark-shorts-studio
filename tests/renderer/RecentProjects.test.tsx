import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentProjects } from '../../src/renderer/components/RecentProjects';
import type { RecentProject } from '../../src/shared/project/types';

afterEach(() => {
  cleanup();
});

function createRecentProject(name: string, filePath: string): RecentProject {
  return {
    filePath,
    projectId: `${name}-id`,
    name,
    lastUsedAt: '2026-09-19T03:00:00.000Z',
  };
}

const defaultProps = {
  projects: [] as RecentProject[],
  loading: false,
  listFailed: false,
  openError: null,
  onRetry: vi.fn(),
  onOpen: vi.fn(),
  onRemove: vi.fn(),
  removeError: false,
};

describe('RecentProjects', () => {
  it('shows an empty recent-project state', () => {
    render(<RecentProjects {...defaultProps} />);

    expect(
      screen.getByRole('region', { name: '최근 프로젝트' }),
    ).toBeInTheDocument();
    expect(screen.getByText('최근 프로젝트가 없습니다.')).toBeInTheDocument();
  });

  it('shows only cssproj filenames and opens the selected item', async () => {
    const user = userEvent.setup();
    const firstProject = createRecentProject(
      '첫 최근 프로젝트',
      'C:\\projects\\first.cssproj',
    );
    const secondProject = createRecentProject(
      '두 번째 최근 프로젝트',
      'C:\\projects\\second.cssproj',
    );
    const onOpen = vi.fn();
    render(
      <RecentProjects
        {...defaultProps}
        projects={[firstProject, secondProject]}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('first.cssproj')).toBeInTheDocument();
    expect(screen.getByText('second.cssproj')).toBeInTheDocument();
    expect(screen.queryByText('첫 최근 프로젝트')).not.toBeInTheDocument();
    expect(screen.queryByText('두 번째 최근 프로젝트')).not.toBeInTheDocument();
    const firstOpenButton = screen.getByRole('button', {
      name: 'first.cssproj',
    });
    expect(firstOpenButton).not.toHaveAttribute('title');
    await user.click(firstOpenButton);

    expect(onOpen).toHaveBeenCalledWith(firstProject.filePath);
  });

  it('removes the selected recent item without opening it', async () => {
    const user = userEvent.setup();
    const project = createRecentProject(
      '내부 이름',
      'C:\\projects\\remove-me.cssproj',
    );
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <RecentProjects
        {...defaultProps}
        projects={[project]}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'remove-me.cssproj 목록에서 제거' }),
    );

    expect(onRemove).toHaveBeenCalledWith(project.filePath);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a recent removal error', () => {
    render(<RecentProjects {...defaultProps} removeError />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '최근 프로젝트를 목록에서 제거하지 못했습니다.',
    );
  });

  it('shows loading without hiding the recent-project region', () => {
    render(<RecentProjects {...defaultProps} loading />);

    expect(
      screen.getByText('최근 프로젝트를 불러오는 중...'),
    ).toBeInTheDocument();
  });

  it('shows a list error and retries', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <RecentProjects
        {...defaultProps}
        listFailed
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText('최근 프로젝트를 불러오지 못했습니다.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', '파일을 찾을 수 없어 최근 목록에서 제거했습니다.'],
    ['open', '최근 프로젝트를 열지 못했습니다.'],
  ] as const)('shows the %s open error', (openError, message) => {
    render(<RecentProjects {...defaultProps} openError={openError} />);

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
