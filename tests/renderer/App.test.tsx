import { act, cleanup, render, screen, within } from '@testing-library/react';
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
  removeRecentProject: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  desktopApi.getAppVersion.mockResolvedValue('0.1.0');
  desktopApi.openMediaDialog.mockResolvedValue([]);
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecentProjects.mockResolvedValue([]);
  desktopApi.removeRecentProject.mockResolvedValue([]);
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('shows saving and success feedback for Save', async () => {
    const user = userEvent.setup();
    let finishWrite: (() => void) | undefined;
    desktopApi.saveProjectDialog.mockResolvedValue(
      'C:\\projects\\saved.cssproj',
    );
    desktopApi.writeProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '저장' }));
    const savingStatus = screen.getByRole('status', { name: '저장 상태' });
    expect(within(savingStatus).getByText('저장 중...')).toBeInTheDocument();
    expect(savingStatus.parentElement).toBe(
      screen.getByRole('banner').nextElementSibling,
    );
    expect(
      within(screen.getByRole('contentinfo')).queryByText('저장 중...'),
    ).not.toBeInTheDocument();

    await act(async () => {
      finishWrite?.();
      await Promise.resolve();
    });
    const successStatus = await screen.findByRole('status', {
      name: '저장 상태',
    });
    expect(within(successStatus).getByText('저장 완료')).toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo')).queryByText('저장 완료'),
    ).not.toBeInTheDocument();
  });

  it('shows a clear error when Save fails', async () => {
    const user = userEvent.setup();
    desktopApi.saveProjectDialog.mockResolvedValue(
      'C:\\projects\\failed.cssproj',
    );
    desktopApi.writeProject.mockRejectedValue(new Error('write failed'));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '저장' }));

    const saveError = await screen.findByRole('alert', { name: '저장 상태' });
    expect(saveError).toHaveTextContent(
      '프로젝트를 저장하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(
      within(screen.getByRole('contentinfo')).queryByText(
        '프로젝트를 저장하지 못했습니다. 다시 시도해 주세요.',
      ),
    ).not.toBeInTheDocument();
  });

  it('leaves the save status empty when Save As is canceled', async () => {
    const user = userEvent.setup();
    desktopApi.saveProjectDialog.mockResolvedValue(null);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(
      screen.getByRole('button', { name: '다른 이름으로 저장' }),
    );

    expect(screen.getByRole('status', { name: '저장 상태' })).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('alert', { name: '저장 상태' }),
    ).not.toBeInTheDocument();
  });

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

    expect(screen.getAllByText('photo.jpg')).toHaveLength(2);
    expect(screen.getAllByText('이미지')).toHaveLength(2);
    expect(screen.getAllByText('clip.mp4')).toHaveLength(2);
    expect(screen.getAllByText('영상')).toHaveLength(2);
    expect(
      await screen.findByRole('img', { name: 'photo.jpg' }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: '1번 장면 자막' }),
      '여행 시작',
    );
    expect(screen.getByText('여행 시작')).toBeInTheDocument();
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
      scenes: [
        {
          mediaId: 'restored-photo-id',
          durationMs: 3000,
          subtitle: '복원된 자막',
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

    expect(await screen.findAllByText('restored.webp')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'restored.webp' })).toBeInTheDocument();
    expect(screen.getByText('복원된 자막')).toBeInTheDocument();
    expect(screen.getByText('저장됨')).toBeInTheDocument();
  });

  it('shows the scene and subtitle selected from the timeline', async () => {
    const user = userEvent.setup();
    const project = {
      ...createNewProject('선택 프로젝트'),
      media: [
        {
          id: 'photo-id',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\photo.jpg',
          fileName: 'photo.jpg',
        },
        {
          id: 'video-id',
          kind: 'video' as const,
          sourcePath: 'C:\\media\\clip.mp4',
          fileName: 'clip.mp4',
        },
      ],
      scenes: [
        { mediaId: 'photo-id', durationMs: 3000, subtitle: '사진 자막' },
        { mediaId: 'video-id', durationMs: null, subtitle: '영상 자막' },
      ],
    };
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\select.cssproj');
    desktopApi.readProject.mockResolvedValue(project);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));
    expect(
      await screen.findByRole('button', { name: '1번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      screen.getByRole('button', { name: '2번 장면 선택' }),
    );

    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    expect(screen.getByText('영상 자막')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
  });

  it('selects the first scene when the same project is opened again', async () => {
    const user = userEvent.setup();
    const project = {
      ...createNewProject('다시 열기 프로젝트'),
      media: [
        {
          id: 'photo-id',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\photo.jpg',
          fileName: 'photo.jpg',
        },
        {
          id: 'video-id',
          kind: 'video' as const,
          sourcePath: 'C:\\media\\clip.mp4',
          fileName: 'clip.mp4',
        },
      ],
      scenes: [
        { mediaId: 'photo-id', durationMs: 3000, subtitle: '' },
        { mediaId: 'video-id', durationMs: null, subtitle: '' },
      ],
    };
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\reopen.cssproj');
    desktopApi.readProject.mockImplementation(async () => structuredClone(project));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 선택' }),
    );
    expect(
      screen.getByRole('button', { name: '2번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '열기' }));

    expect(
      await screen.findByRole('button', { name: '1번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'photo.jpg' })).toBeInTheDocument();
  });

  it('keeps the same scene selected after reordering', async () => {
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
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 선택' }),
    );

    const selectedItem = screen
      .getByRole('button', { name: '2번 장면 선택' })
      .closest('li');
    await user.click(
      within(selectedItem as HTMLElement).getByRole('button', { name: '위' }),
    );

    expect(
      screen.getByRole('button', { name: '1번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('falls back to the first remaining scene when the selection is deleted', async () => {
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
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 선택' }),
    );

    const selectedItem = screen
      .getByRole('button', { name: '2번 장면 선택' })
      .closest('li');
    await user.click(
      within(selectedItem as HTMLElement).getByRole('button', {
        name: '파일 제거',
      }),
    );

    expect(
      await screen.findByRole('button', { name: '1번 장면 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'photo.jpg' })).toBeInTheDocument();
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('stops playback when every scene is deleted', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'first-photo-id',
        kind: 'image',
        sourcePath: 'C:\\media\\first.jpg',
        fileName: 'first.jpg',
      },
    ]);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    await user.click(await screen.findByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeEnabled();

    const selectedItem = screen
      .getByRole('button', { name: '1번 장면 선택' })
      .closest('li');
    await user.click(
      within(selectedItem as HTMLElement).getByRole('button', {
        name: '파일 제거',
      }),
    );

    expect(await screen.findByRole('button', { name: '재생' })).toBeDisabled();
    expect(screen.queryByText('first.jpg')).not.toBeInTheDocument();

    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'second-photo-id',
        kind: 'image',
        sourcePath: 'C:\\media\\second.jpg',
        fileName: 'second.jpg',
      },
    ]);
    await user.click(screen.getByRole('button', { name: '파일 추가' }));

    expect(await screen.findByRole('button', { name: '재생' })).toBeEnabled();
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

    expect(screen.getByRole('region', { name: '장면 목록' })).toBeInTheDocument();
    expect(screen.getByText('장면이 없습니다.')).toBeInTheDocument();
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

    expect(await screen.findByText('recent.cssproj')).toBeInTheDocument();
  });

  it('removes a recent project from the displayed list', async () => {
    const user = userEvent.setup();
    const firstProject = {
      filePath: 'C:\\projects\\first.cssproj',
      projectId: 'first-id',
      name: '새 프로젝트',
      lastUsedAt: '2026-09-19T04:00:00.000Z',
    };
    const secondProject = {
      filePath: 'C:\\projects\\second.cssproj',
      projectId: 'second-id',
      name: '새 프로젝트',
      lastUsedAt: '2026-09-19T03:00:00.000Z',
    };
    desktopApi.listRecentProjects.mockResolvedValue([
      firstProject,
      secondProject,
    ]);
    desktopApi.removeRecentProject.mockResolvedValue([secondProject]);
    render(<App />);

    expect(await screen.findByText('first.cssproj')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'first.cssproj 목록에서 제거' }),
    );

    expect(screen.queryByText('first.cssproj')).not.toBeInTheDocument();
    expect(screen.getByText('second.cssproj')).toBeInTheDocument();
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
