import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { createNewProject } from '../../src/shared/project/createProject';

const desktopApi = {
  getAppVersion: vi.fn(),
  openProjectDialog: vi.fn(),
  saveProjectDialog: vi.fn(),
  readProject: vi.fn(),
  writeProject: vi.fn(),
  writeRecovery: vi.fn(),
  deleteRecovery: vi.fn(),
  listRecoveries: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  desktopApi.getAppVersion.mockResolvedValue('0.1.0');
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('blocks the editor while recovery lookup is pending', async () => {
    let finishLookup: (() => void) | undefined;
    desktopApi.listRecoveries.mockReturnValue(
      new Promise((resolve) => {
        finishLookup = () => resolve([]);
      }),
    );
    render(<App />);

    expect(screen.getByText('복구 파일 확인 중...')).toBeInTheDocument();
    expect(screen.queryByText('Combark Shorts Studio')).not.toBeInTheDocument();

    finishLookup?.();
    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
  });

  it('renders the approved editor shell', async () => {
    render(<App />);

    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
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

  it('shows the recovery prompt instead of the editor when candidates exist', async () => {
    const project = createNewProject('시작 복구 프로젝트');
    desktopApi.listRecoveries.mockResolvedValue([
      {
        projectId: project.projectId,
        name: project.name,
        modifiedAt: '2026-09-19T02:00:00.000Z',
        project,
      },
    ]);

    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('시작 복구 프로젝트')).toBeInTheDocument();
    expect(screen.queryByText('Combark Shorts Studio')).not.toBeInTheDocument();
  });

  it('shows a lookup error and retries before entering the editor', async () => {
    const user = userEvent.setup();
    desktopApi.listRecoveries
      .mockRejectedValueOnce(new Error('list failed'))
      .mockResolvedValueOnce([]);
    render(<App />);

    expect(
      await screen.findByText('복구 파일을 확인하지 못했습니다.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Combark Shorts Studio')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
    expect(desktopApi.listRecoveries).toHaveBeenCalledTimes(2);
  });

  it('enters the editor with a recovered project marked as needing save', async () => {
    const user = userEvent.setup();
    const project = createNewProject('복구된 프로젝트');
    desktopApi.listRecoveries.mockResolvedValue([
      {
        projectId: project.projectId,
        name: project.name,
        modifiedAt: '2026-09-19T02:00:00.000Z',
        project,
      },
    ]);
    render(<App />);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: '복구' }));

    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
    expect(screen.getByText('복구된 프로젝트')).toBeInTheDocument();
    expect(screen.getByText('저장 필요')).toBeInTheDocument();
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
  });
});
