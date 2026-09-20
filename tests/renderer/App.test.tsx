import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { createNewProject } from '../../src/shared/project/createProject';

const desktopApi = {
  getAppVersion: vi.fn(),
  openMediaDialog: vi.fn(),
  openProjectDialog: vi.fn(),
  saveProjectDialog: vi.fn(),
  readProject: vi.fn(),
  writeProject: vi.fn(),
  writeRecovery: vi.fn(),
  deleteRecovery: vi.fn(),
  listRecoveries: vi.fn(),
  listRecentProjects: vi.fn(),
  openRecentProject: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  desktopApi.getAppVersion.mockResolvedValue('0.1.0');
  desktopApi.openMediaDialog.mockResolvedValue([]);
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecentProjects.mockResolvedValue([]);
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('adds selected image and video files to the media list', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
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
    ]);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '파일 추가' }));

    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('이미지')).toBeInTheDocument();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('영상')).toBeInTheDocument();
    expect(screen.getByText('저장 필요')).toBeInTheDocument();
  });

  it('shows media restored from an opened project', async () => {
    const user = userEvent.setup();
    const project = {
      ...createNewProject('미디어 프로젝트'),
      media: [
        {
          id: 'restored-photo-id',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\restored.webp',
          fileName: 'restored.webp',
        },
      ],
    };
    desktopApi.openProjectDialog.mockResolvedValue(
      'C:\\projects\\media.cssproj',
    );
    desktopApi.readProject.mockResolvedValue(project);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));

    expect(await screen.findByText('restored.webp')).toBeInTheDocument();
    expect(screen.getByText('저장됨')).toBeInTheDocument();
  });

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
    expect(
      screen.getByRole('region', { name: '최근 프로젝트' }),
    ).toBeInTheDocument();

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
    expect(screen.queryByText('최근 프로젝트')).not.toBeInTheDocument();
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

  it('shows recent-project errors without blocking the editor', async () => {
    desktopApi.listRecentProjects.mockRejectedValue(new Error('list failed'));
    render(<App />);

    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
    expect(
      await screen.findByText('최근 프로젝트를 불러오지 못했습니다.'),
    ).toBeInTheDocument();
  });

  it('shows recent projects only after recovery is resolved', async () => {
    const user = userEvent.setup();
    const recoveryProject = createNewProject('복구 우선 프로젝트');
    desktopApi.listRecoveries.mockResolvedValue([
      {
        projectId: recoveryProject.projectId,
        name: recoveryProject.name,
        modifiedAt: '2026-09-19T02:00:00.000Z',
        project: recoveryProject,
      },
    ]);
    desktopApi.listRecentProjects.mockResolvedValue([
      {
        filePath: 'C:\\projects\\recent.cssproj',
        projectId: 'recent-project-id',
        name: '최근 프로젝트 항목',
        lastUsedAt: '2026-09-19T03:00:00.000Z',
      },
    ]);
    render(<App />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('최근 프로젝트 항목')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '복구' }));

    expect(await screen.findByText('최근 프로젝트 항목')).toBeInTheDocument();
  });

  it('shows a general Open error without replacing the current project', async () => {
    const user = userEvent.setup();
    desktopApi.openProjectDialog.mockResolvedValue(
      'C:\\projects\\invalid.cssproj',
    );
    desktopApi.readProject.mockRejectedValueOnce(
      new Error('유효하지 않은 프로젝트 파일입니다.'),
    );
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '프로젝트를 열지 못했습니다. 유효한 .cssproj 파일인지 확인해 주세요.',
    );
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('새 프로젝트')).toBeInTheDocument();
    expect(within(footer).getByText('저장됨')).toBeInTheDocument();
  });
});
