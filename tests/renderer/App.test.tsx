import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { createNewProject } from '../../src/shared/project/createProject';

const desktopApi = {
  getAppVersion: vi.fn(),
  openContactSheetImages: vi.fn(),
  analyzeContactSheets: vi.fn(),
  createContactSheetVideo: vi.fn(),
  cancelContactSheetVideo: vi.fn(),
  onContactSheetVideoProgress: vi.fn(),
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

function loadPreviewVideoDuration(
  container: HTMLElement,
  mediaId: string,
  duration: number,
): void {
  const metadataVideo = container.querySelector(
    `video[data-preview-metadata-id="${mediaId}"]`,
  ) as HTMLVideoElement;
  expect(metadataVideo).not.toBeNull();
  Object.defineProperty(metadataVideo, 'duration', {
    configurable: true,
    value: duration,
  });
  fireEvent.loadedMetadata(metadataVideo);
}

function openMediaDrawer(): void {
  if (!screen.queryByRole('complementary', { name: '미디어' })) {
    fireEvent.click(screen.getByRole('button', { name: '미디어 열기' }));
  }
}

function expandSelectedSceneDetail(): void {
  const toggle = screen.queryByRole('button', {
    name: '선택 장면 상세 펼치기',
  });
  if (toggle) {
    fireEvent.click(toggle);
  }
}

function expandRecentProjects(): void {
  const toggle = screen.queryByRole('button', {
    name: '최근 프로젝트 펼치기',
  });
  if (toggle) {
    fireEvent.click(toggle);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  );
  desktopApi.getAppVersion.mockResolvedValue('0.1.0');
  desktopApi.openContactSheetImages.mockResolvedValue([]);
  desktopApi.analyzeContactSheets.mockResolvedValue([]);
  desktopApi.createContactSheetVideo.mockResolvedValue({ status: 'canceled' });
  desktopApi.cancelContactSheetVideo.mockResolvedValue(undefined);
  desktopApi.onContactSheetVideoProgress.mockReturnValue(vi.fn());
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
  it('opens the contact-sheet workflow and disables general export while it creates', async () => {
    const user = userEvent.setup();
    const sheet = {
      id: 'sheet-id',
      sourcePath: 'C:\\images\\sheet.png',
      fileName: 'sheet.png',
    };
    let finish: ((result: { status: 'canceled' }) => void) | undefined;
    desktopApi.openContactSheetImages.mockResolvedValue([sheet]);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheet.id, status: 'recognized', frameCount: 16 },
    ]);
    desktopApi.createContactSheetVideo.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    const workflowButton = screen.getByRole('button', {
      name: '연속 프레임 영상 만들기',
    });
    const exportButton = screen.getByRole('button', { name: 'MP4 내보내기' });
    await user.click(workflowButton);
    expect(screen.getByRole('dialog', { name: '연속 프레임 영상 만들기' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findByText('16프레임 인식');
    await user.click(screen.getByRole('button', { name: '영상 만들기' }));

    expect(workflowButton).toBeDisabled();
    expect(exportButton).toBeDisabled();
    finish?.({ status: 'canceled' });
    await vi.waitFor(() => expect(exportButton).toBeEnabled());
  });

  it('keeps general export available while the contact dialog is idle and disables contact creation during export', async () => {
    const user = userEvent.setup();
    const sheet = {
      id: 'sheet-id',
      sourcePath: 'C:\\images\\sheet.png',
      fileName: 'sheet.png',
    };
    let finishExport: ((value: { status: 'canceled' }) => void) | undefined;
    desktopApi.openContactSheetImages.mockResolvedValue([sheet]);
    desktopApi.analyzeContactSheets.mockResolvedValue([
      { id: sheet.id, status: 'recognized', frameCount: 16 },
    ]);
    desktopApi.exportMp4.mockReturnValue(new Promise((resolve) => {
      finishExport = resolve;
    }));
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', {
      name: '연속 프레임 영상 만들기',
    }));
    const exportButton = screen.getByRole('button', { name: 'MP4 내보내기' });
    expect(exportButton).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Contact sheet 이미지 추가' }));
    await screen.findByText('16프레임 인식');
    await user.click(exportButton);

    expect(screen.getByRole('button', { name: '영상 만들기' })).toBeDisabled();
    finishExport?.({ status: 'canceled' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '영상 만들기' })).toBeEnabled();
    });
  });

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
    expect(savingStatus.parentElement?.parentElement).toBe(
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
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();

    await user.click(screen.getByRole('button', { name: '파일 추가' }));

    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: 'photo.jpg' }),
    ).toBeInTheDocument();

    const metadataVideo = container.querySelector(
      'video[data-preview-metadata-id="video-id"]',
    ) as HTMLVideoElement;
    Object.defineProperty(metadataVideo, 'duration', {
      configurable: true,
      value: 4,
    });
    fireEvent.loadedMetadata(metadataVideo);
    expect(
      await screen.findByRole('button', { name: '1번 장면 photo.jpg' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '2번 장면 clip.mp4' }),
    ).toBeInTheDocument();
    expandSelectedSceneDetail();

    await user.type(
      screen.getByRole('textbox', { name: '선택 장면 자막' }),
      '여행 시작',
    );
    expect(screen.getAllByText('여행 시작').length).toBeGreaterThan(0);
    expect(screen.getByText('저장 필요')).toBeInTheDocument();
  });

  it('keeps the multitrack playhead synchronized with preview seeking', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'photo-id',
        kind: 'image',
        sourcePath: 'C:\\media\\photo.jpg',
        fileName: 'photo.jpg',
      },
    ]);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    await screen.findByRole('button', { name: '1번 장면 photo.jpg' });

    const previewSeek = screen.getByRole('slider', {
      name: '전체 프로젝트 재생 위치',
    });
    expect(previewSeek).toBeEnabled();
    fireEvent.input(
      previewSeek,
      { target: { value: '1500' } },
    );

    expect(previewSeek).toHaveValue('1500');
    await waitFor(() =>
      expect(screen.getByLabelText('재생 위치선')).toHaveStyle({ left: '90px' }),
    );
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
    openMediaDrawer();

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

    expect(
      await screen.findByRole('button', { name: '1번 장면 restored.webp' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'restored.webp' })).toBeInTheDocument();
    expect(screen.getAllByText('복원된 자막').length).toBeGreaterThan(0);
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
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));
    const metadataVideo = container.querySelector(
      'video[data-preview-metadata-id="video-id"]',
    ) as HTMLVideoElement;
    Object.defineProperty(metadataVideo, 'duration', {
      configurable: true,
      value: 4,
    });
    fireEvent.loadedMetadata(metadataVideo);
    expect(
      await screen.findByRole('button', { name: '1번 장면 photo.jpg' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(
      screen.getByRole('button', { name: '2번 장면 clip.mp4' }),
    );
    expandSelectedSceneDetail();

    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
    expect(container.querySelector('.preview-subtitle')).toHaveTextContent(
      '영상 자막',
    );
    expect(screen.getByRole('button', { name: '재생' })).toBeEnabled();
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('3000');

    await user.selectOptions(
      screen.getByRole('combobox', { name: '선택 장면 자막 위치' }),
      'top',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: '선택 장면 자막 크기' }),
      'large',
    );

    const subtitle = container.querySelector('.preview-subtitle') as HTMLElement;
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
    expandSelectedSceneDetail();

    await user.click(screen.getByRole('button', { name: '선택 장면 복제' }));
    let sceneButtons = screen.getAllByRole('button', {
      name: /^\d+번 장면 photo\.jpg$/,
    });
    expect(sceneButtons).toHaveLength(2);
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(sceneButtons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('3000');

    const subtitleInput = screen.getByRole('textbox', {
      name: '선택 장면 자막',
    });
    await user.clear(subtitleInput);
    await user.type(subtitleInput, '복제 자막');
    expect(subtitleInput).toHaveValue('복제 자막');
    expect(screen.getAllByText('복제 자막').length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole('button', { name: '선택 장면 이전으로 이동' }),
    );
    sceneButtons = screen.getAllByRole('button', {
      name: /^\d+번 장면 photo\.jpg$/,
    });
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('복제 자막').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('0');

    await user.click(
      screen.getByRole('button', { name: '선택 장면 삭제' }),
    );
    sceneButtons = screen.getAllByRole('button', {
      name: /^\d+번 장면 photo\.jpg$/,
    });
    expect(sceneButtons).toHaveLength(1);
    expect(sceneButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: '선택 장면 자막' })).toHaveValue(
      '원본 자막',
    );
    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveValue('0');

    await user.click(screen.getByRole('button', { name: '선택 장면 삭제' }));
    expect(
      screen.queryByRole('button', { name: /^\d+번 장면 photo\.jpg$/ }),
    ).not.toBeInTheDocument();
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
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');

    await user.click(screen.getByRole('button', { name: '열기' }));
    loadPreviewVideoDuration(container, 'video-id', 4);
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 clip.mp4' }),
    );
    expect(
      screen.getByRole('button', { name: '2번 장면 clip.mp4' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '열기' }));

    expect(
      await screen.findByRole('button', { name: '1번 장면 photo.jpg' }),
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
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    loadPreviewVideoDuration(container, 'video-id', 4);
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 clip.mp4' }),
    );

    await user.click(
      screen.getByRole('button', { name: '선택 장면 이전으로 이동' }),
    );

    expect(
      screen.getByRole('button', { name: '1번 장면 clip.mp4' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('clip.mp4 미리보기')).toBeInTheDocument();
  });

  it('keeps the dragged scene selected after moving it across multiple indexes', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue(
      ['a', 'b', 'c'].map((name) => ({
        id: `photo-${name}`,
        kind: 'image' as const,
        sourcePath: `C:\\media\\${name}.png`,
        fileName: `${name}.png`,
      })),
    );
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    const scroll = container.querySelector('.timeline-scroll') as HTMLElement;
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 800, top: 0, bottom: 200,
      width: 800, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    const draggedClip = await screen.findByRole('button', {
      name: '3번 장면 c.png',
    });

    fireEvent.pointerDown(draggedClip, { pointerId: 11, clientX: 400 });
    fireEvent.pointerMove(draggedClip, { pointerId: 11, clientX: 10 });
    fireEvent.pointerUp(draggedClip, { pointerId: 11, clientX: 10 });

    expect(
      await screen.findByRole('button', { name: '1번 장면 c.png' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'c.png' })).toBeInTheDocument();
  });

  it('applies a timeline image resize to the project preview duration', async () => {
    const user = userEvent.setup();
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'photo-id',
        kind: 'image',
        sourcePath: 'C:\\media\\photo.jpg',
        fileName: 'photo.jpg',
      },
    ]);
    render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    const handle = await screen.findByRole('button', {
      name: '1번 장면 길이 조절',
    });

    fireEvent.pointerDown(handle, { pointerId: 12, clientX: 180 });
    fireEvent.pointerMove(handle, { pointerId: 12, clientX: 240 });
    fireEvent.pointerUp(handle, { pointerId: 12, clientX: 240 });

    expect(
      screen.getByRole('slider', { name: '전체 프로젝트 재생 위치' }),
    ).toHaveAttribute('max', '4000');
    expect(screen.getByText('저장 필요')).toBeInTheDocument();
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
    const { container } = render(<App />);
    await screen.findByText('Combark Shorts Studio');
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    loadPreviewVideoDuration(container, 'video-id', 4);
    await user.click(
      await screen.findByRole('button', { name: '2번 장면 clip.mp4' }),
    );

    await user.click(
      screen.getByRole('button', { name: '선택 장면 삭제' }),
    );

    expect(
      await screen.findByRole('button', { name: '1번 장면 photo.jpg' }),
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
    openMediaDrawer();
    await user.click(screen.getByRole('button', { name: '파일 추가' }));
    await user.click(await screen.findByRole('button', { name: '재생' }));
    expect(screen.getByRole('button', { name: '일시정지' })).toBeEnabled();

    await user.click(
      screen.getByRole('button', { name: '선택 장면 삭제' }),
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

    expect(screen.getByRole('button', { name: '미디어 열기' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '미리보기' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '미리보기' })).not.toBeInTheDocument();
    expect(screen.queryByText('속성')).not.toBeInTheDocument();

    expect(screen.getByRole('region', { name: '타임라인' })).toBeInTheDocument();
    expect(await screen.findByText('장면이 없습니다.')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: '최근 프로젝트' }),
    ).toBeInTheDocument();

    expect(await screen.findByText('v0.1.0')).toBeInTheDocument();
  });

  it('opens and closes media as an overlay drawer', async () => {
    render(<App />);
    await screen.findByText('Combark Shorts Studio');

    expect(screen.queryByRole('complementary', { name: '미디어' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '미디어 열기' }));
    expect(screen.getByRole('complementary', { name: '미디어' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '미디어 닫기' }));
    expect(screen.queryByRole('complementary', { name: '미디어' })).toBeNull();
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
          playbackDurationMs: null,
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
    expandSelectedSceneDetail();
    expect(screen.getByRole('textbox', { name: '선택 장면 자막' })).toHaveValue(
      '자동 생성 자막',
    );
    expect(
      screen.getByRole('spinbutton', { name: '이미지 표시시간 (초)' }),
    ).toHaveValue(3);
    expect(
      screen.getByRole('combobox', { name: '선택 장면 자막 위치' }),
    ).toHaveValue('top');
    expect(
      screen.getByRole('combobox', { name: '선택 장면 자막 크기' }),
    ).toHaveValue('large');
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
    expandRecentProjects();

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

    expect(await screen.findByText('Combark Shorts Studio')).toBeInTheDocument();
    expandRecentProjects();
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
    openMediaDrawer();

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
    openMediaDrawer();

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
    openMediaDrawer();

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
