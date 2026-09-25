import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { createNewProject } from '../../src/shared/project/createProject';

const desktopApi = {
  getAppVersion: vi.fn(),
  exportMp4: vi.fn(),
  onExportProgress: vi.fn(),
  openMediaDialog: vi.fn(),
  openNarrationDialog: vi.fn(),
  checkProjectSources: vi.fn(),
  relinkSourceFile: vi.fn(),
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
  confirmUnsavedChanges: vi.fn(),
  onWindowCloseRequested: vi.fn(),
  respondToWindowClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  );
  desktopApi.getAppVersion.mockResolvedValue('0.1.0');
  desktopApi.openMediaDialog.mockResolvedValue([]);
  desktopApi.openNarrationDialog.mockResolvedValue(null);
  desktopApi.checkProjectSources.mockResolvedValue({
    missingMediaIds: [],
    narrationMissing: false,
  });
  desktopApi.relinkSourceFile.mockResolvedValue(null);
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecentProjects.mockResolvedValue([]);
  desktopApi.removeRecentProject.mockResolvedValue([]);
  desktopApi.exportMp4.mockResolvedValue({ status: 'canceled' });
  desktopApi.onExportProgress.mockReturnValue(vi.fn());
  desktopApi.confirmUnsavedChanges.mockResolvedValue('cancel');
  desktopApi.onWindowCloseRequested.mockReturnValue(vi.fn());
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('disables MP4 export while running and shows success feedback', async () => {
    let progressListener: ((progress: unknown) => void) | undefined;
    desktopApi.onExportProgress.mockImplementation((listener) => {
      progressListener = listener;
      return vi.fn();
    });
    const user = userEvent.setup();
    let finishExport: ((value: { status: 'success'; filePath: string }) => void) | undefined;
    desktopApi.exportMp4.mockReturnValue(new Promise((resolve) => { finishExport = resolve; }));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    const button = screen.getByRole('button', { name: 'MP4 내보내기' });
    const autoShortsButton = screen.getByRole('button', {
      name: '쇼츠 자동 만들기',
    });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(autoShortsButton).toBeDisabled();
    expect(button).toHaveTextContent('내보내는 중...');
    expect(screen.getByRole('status', { name: '내보내기 상태' })).toHaveTextContent(
      '내보내기 준비 중...',
    );

    act(() => {
      progressListener?.({ stage: 'scene', sceneIndex: 2, sceneCount: 5 });
    });
    expect(screen.getByRole('status', { name: '내보내기 상태' })).toHaveTextContent(
      '장면 2/5 처리 중...',
    );

    act(() => {
      progressListener?.({ stage: 'concatenating' });
    });
    expect(screen.getByRole('status', { name: '내보내기 상태' })).toHaveTextContent(
      '장면 합치는 중...',
    );

    act(() => {
      progressListener?.({ stage: 'muxing-audio' });
    });
    expect(screen.getByRole('status', { name: '내보내기 상태' })).toHaveTextContent(
      '오디오 합치는 중...',
    );

    act(() => {
      progressListener?.({ stage: 'writing-output' });
    });
    expect(screen.getByRole('status', { name: '내보내기 상태' })).toHaveTextContent(
      '파일 저장 중...',
    );

    await act(async () => {
      finishExport?.({ status: 'success', filePath: 'C:\\exports\\video.mp4' });
      await Promise.resolve();
    });
    expect(await screen.findByText('MP4 내보내기 완료')).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(autoShortsButton).toBeEnabled();
  });

  it('shows an MP4 export failure message', async () => {
    const user = userEvent.setup();
    desktopApi.exportMp4.mockRejectedValue(new Error('ffmpeg failed'));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    await user.click(screen.getByRole('button', { name: 'MP4 내보내기' }));
    expect(await screen.findByRole('alert', { name: '내보내기 상태' })).toHaveTextContent(
      'MP4 파일을 내보내지 못했습니다.',
    );
  });

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

  it('separates media and narration pickers while allowing narration replacement', async () => {
    const user = userEvent.setup();
    desktopApi.openNarrationDialog
      .mockResolvedValueOnce({
        sourcePath: 'C:\\audio\\voice.mp3',
        fileName: 'voice.mp3',
      })
      .mockResolvedValueOnce({
        sourcePath: 'C:\\audio\\new-voice.wav',
        fileName: 'new-voice.wav',
      });
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    expect(
      screen.getByRole('button', { name: '파일 추가' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 선택' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 선택' }),
    );
    expect(desktopApi.openNarrationDialog).toHaveBeenCalledTimes(1);
    expect(desktopApi.openMediaDialog).not.toHaveBeenCalled();
    expect(screen.getByText('voice.mp3')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 교체' }),
    ).toBeInTheDocument();
    expect(screen.getByText('저장 필요')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 교체' }),
    );
    expect(desktopApi.openNarrationDialog).toHaveBeenCalledTimes(2);
    expect(desktopApi.openMediaDialog).not.toHaveBeenCalled();
    expect(screen.getByText('new-voice.wav')).toBeInTheDocument();
    expect(screen.queryByText('voice.mp3')).not.toBeInTheDocument();
    expect(screen.getByLabelText('내레이션')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '내레이션 제거' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '내레이션 제거' }));
    expect(screen.queryByText('new-voice.wav')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('내레이션')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '내레이션 제거' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    expect(desktopApi.openMediaDialog).toHaveBeenCalledTimes(1);
    expect(desktopApi.openNarrationDialog).toHaveBeenCalledTimes(2);
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
          subtitlePosition: 'bottom' as const,
          subtitleSize: 'medium' as const,
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
        { mediaId: 'photo-id', durationMs: 3000, subtitle: '사진 자막', subtitlePosition: 'bottom' as const, subtitleSize: 'medium' as const },
        { mediaId: 'video-id', durationMs: null, subtitle: '영상 자막', subtitlePosition: 'center' as const, subtitleSize: 'small' as const },
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: '2번 장면 자막 위치' }),
      'top',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: '2번 장면 자막 크기' }),
      'large',
    );

    const subtitle = screen.getByText('영상 자막');
    expect(subtitle.style.top).toBe(`${(150 / 1920) * 100}%`);
    expect(subtitle.style.fontSize).toBe(`${(80 / 1080) * 100}cqw`);
    expect(screen.getByText('저장 필요')).toBeInTheDocument();
  });

  it('selects a duplicate and preserves logical selection through move and delete', async () => {
    const user = userEvent.setup();
    const project = {
      ...createNewProject('복제 프로젝트'),
      media: [
        {
          id: 'photo-id',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\photo.jpg',
          fileName: 'photo.jpg',
        },
      ],
      scenes: [
        {
          mediaId: 'photo-id',
          durationMs: 3000,
          subtitle: '원본 자막',
          subtitlePosition: 'bottom' as const,
          subtitleSize: 'medium' as const,
        },
      ],
    };
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\duplicate.cssproj');
    desktopApi.readProject.mockResolvedValue(project);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    await user.click(screen.getByRole('button', { name: '열기' }));

    await user.click(screen.getByRole('button', { name: '복제' }));
    let sceneButtons = screen.getAllByRole('button', { name: /번 장면 선택/ });
    expect(sceneButtons).toHaveLength(2);
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(sceneButtons[1]).toHaveAttribute('aria-pressed', 'true');

    const subtitleInputs = screen.getAllByRole('textbox', { name: /번 장면 자막/ });
    await user.clear(subtitleInputs[1]);
    await user.type(subtitleInputs[1], '복제 자막');
    expect(subtitleInputs[0]).toHaveValue('원본 자막');
    expect(screen.getByText('복제 자막')).toBeInTheDocument();

    const itemBeforeMove = sceneButtons[1].closest('li');
    expect(itemBeforeMove).not.toBeNull();
    await user.click(
      within(itemBeforeMove as HTMLLIElement).getByRole('button', { name: '위' }),
    );
    sceneButtons = screen.getAllByRole('button', { name: /번 장면 선택/ });
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('복제 자막')).toBeInTheDocument();

    const itemBeforeDelete = sceneButtons[0].closest('li');
    expect(itemBeforeDelete).not.toBeNull();
    await user.click(
      within(itemBeforeDelete as HTMLLIElement).getByRole('button', {
        name: '파일 제거',
      }),
    );
    sceneButtons = screen.getAllByRole('button', { name: /번 장면 선택/ });
    expect(sceneButtons).toHaveLength(1);
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('원본 자막')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '파일 제거' }));
    expect(screen.queryByRole('button', { name: /번 장면 선택/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '재생' })).toBeDisabled();
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
        { mediaId: 'photo-id', durationMs: 3000, subtitle: '', subtitlePosition: 'bottom' as const, subtitleSize: 'medium' as const },
        { mediaId: 'video-id', durationMs: null, subtitle: '', subtitlePosition: 'bottom' as const, subtitleSize: 'medium' as const },
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
    expect(screen.getByRole('button', { name: 'MP4 내보내기' })).toBeInTheDocument();

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

  it('opens auto shorts from the header and applies subtitles and image duration to the existing scene', async () => {
    const user = userEvent.setup();
    const project = {
      ...createNewProject('자동 구성 프로젝트'),
      media: [
        {
          id: 'auto-image',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\auto.jpg',
          fileName: 'auto.jpg',
        },
      ],
      scenes: [
        {
          mediaId: 'auto-image',
          durationMs: 4500,
          subtitle: '기존 자막',
          subtitlePosition: 'top' as const,
          subtitleSize: 'large' as const,
        },
      ],
    };
    desktopApi.openProjectDialog.mockResolvedValue(
      'C:\\projects\\auto.cssproj',
    );
    desktopApi.readProject.mockResolvedValue(project);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    await user.click(screen.getByRole('button', { name: '열기' }));

    await user.click(
      screen.getByRole('button', { name: '쇼츠 자동 만들기' }),
    );
    expect(
      screen.getByRole('dialog', { name: '쇼츠 자동 만들기' }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: '대본 또는 자막' }),
      '자동 생성 자막',
    );
    await user.click(screen.getByRole('button', { name: '자동 구성 적용' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('자동 생성 자막')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '표시시간 (초)' })).toHaveValue(3);
    expect(screen.getByRole('combobox', { name: '1번 장면 자막 위치' })).toHaveValue('top');
    expect(screen.getByRole('combobox', { name: '1번 장면 자막 크기' })).toHaveValue('large');
    expect(within(screen.getByRole('contentinfo')).getByText('저장 필요')).toBeInTheDocument();
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

  it('shows a transition cleanup error when explicit discard cannot remove recovery', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'dirty-image',
        kind: 'image',
        sourcePath: 'C:\\media\\dirty.jpg',
        fileName: 'dirty.jpg',
      },
    ]);
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    desktopApi.deleteRecovery.mockRejectedValue(new Error('cleanup failed'));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    await screen.findAllByText('dirty.jpg');
    await user.click(screen.getByRole('button', { name: '새 프로젝트' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '변경 사항을 안전하게 정리하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(screen.getAllByText('dirty.jpg').length).toBeGreaterThan(0);
  });

  it('shows missing source details and reconnects media from the sidebar', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'missing-image',
        kind: 'image',
        sourcePath: 'C:\\missing\\old.jpg',
        fileName: 'old.jpg',
      },
    ]);
    desktopApi.checkProjectSources
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: false })
      .mockResolvedValueOnce({
        missingMediaIds: ['missing-image'],
        narrationMissing: false,
      })
      .mockResolvedValue({ missingMediaIds: [], narrationMissing: false });
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\restored\\new.png',
      fileName: 'new.png',
    });
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    expect(await screen.findByText('원본 파일 없음')).toBeInTheDocument();
    expect(screen.getByText('C:\\missing\\old.jpg')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'old.jpg 파일 다시 찾기' }),
    );

    expect(await screen.findAllByText('new.png')).toHaveLength(2);
    expect(screen.queryByText('C:\\missing\\old.jpg')).not.toBeInTheDocument();
    expect(screen.queryByText('원본 파일 없음')).not.toBeInTheDocument();
    expect(desktopApi.relinkSourceFile).toHaveBeenCalledWith(
      'image',
      'C:\\missing\\old.jpg',
    );
    expect(within(screen.getByRole('contentinfo')).getByText('저장 필요')).toBeInTheDocument();
  });

  it('shows missing narration details and keeps a source-check failure non-blocking', async () => {
    const user = userEvent.setup();
    desktopApi.openNarrationDialog.mockResolvedValue({
      sourcePath: 'C:\\missing\\old.mp3',
      fileName: 'old.mp3',
    });
    desktopApi.checkProjectSources
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: false })
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: true });
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(
      screen.getByRole('button', { name: 'MP3/WAV 내레이션 선택' }),
    );
    expect(await screen.findByText('내레이션 원본 파일 없음')).toBeInTheDocument();
    expect(screen.getByText('C:\\missing\\old.mp3')).toBeInTheDocument();

    desktopApi.checkProjectSources.mockRejectedValueOnce(new Error('failed'));
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\audio\\new.wav',
      fileName: 'new.wav',
    });
    await user.click(
      screen.getByRole('button', { name: 'old.mp3 파일 다시 찾기' }),
    );

    expect(
      await screen.findByText('원본 파일 상태를 확인하지 못했습니다.'),
    ).toBeInTheDocument();
    expect(screen.getByText('new.wav')).toBeInTheDocument();
    expect(screen.getByText('Combark Shorts Studio')).toBeInTheDocument();
  });
});
