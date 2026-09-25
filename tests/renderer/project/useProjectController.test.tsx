import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../../src/shared/project/createProject';
import { useProjectController } from '../../../src/renderer/project/useProjectController';
import type { ProjectState } from '../../../src/renderer/project/projectState';
import type {
  RecentProject,
  RecoveryCandidate,
} from '../../../src/shared/project/types';

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
  desktopApi.writeRecovery.mockResolvedValue(undefined);
  desktopApi.openMediaDialog.mockResolvedValue([]);
  desktopApi.openNarrationDialog.mockResolvedValue(null);
  desktopApi.checkProjectSources.mockResolvedValue({
    missingMediaIds: [],
    narrationMissing: false,
  });
  desktopApi.relinkSourceFile.mockResolvedValue(null);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.listRecentProjects.mockResolvedValue([]);
  desktopApi.removeRecentProject.mockResolvedValue([]);
  desktopApi.exportMp4.mockResolvedValue({ status: 'canceled' });
  desktopApi.onExportProgress.mockReturnValue(vi.fn());
  desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
  desktopApi.onWindowCloseRequested.mockReturnValue(vi.fn());
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function createState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    project: createNewProject('자동저장 프로젝트'),
    filePath: 'C:\\projects\\autosave.cssproj',
    dirty: true,
    lastSavedAt: null,
    ...overrides,
  };
}

function createSceneState(): ProjectState {
  return createState({
    dirty: false,
    project: {
      ...createNewProject('scene project'),
      updatedAt: '2026-09-19T00:00:00.000Z',
      media: [
        {
          id: 'first-image',
          kind: 'image',
          sourcePath: 'C:\\media\\first.jpg',
          fileName: 'first.jpg',
        },
        {
          id: 'middle-video',
          kind: 'video',
          sourcePath: 'C:\\media\\middle.mp4',
          fileName: 'middle.mp4',
        },
        {
          id: 'last-image',
          kind: 'image',
          sourcePath: 'C:\\media\\last.png',
          fileName: 'last.png',
        },
      ],
      scenes: [
        { mediaId: 'first-image', durationMs: 3000, subtitle: '첫 장면', subtitlePosition: 'bottom', subtitleSize: 'medium' },
        { mediaId: 'middle-video', durationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
        { mediaId: 'last-image', durationMs: 3000, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
      ],
    },
  });
}

function createRecoveryCandidate(name: string): RecoveryCandidate {
  const project = createNewProject(name);

  return {
    projectId: project.projectId,
    name,
    modifiedAt: '2026-09-19T01:02:03.000Z',
    project,
  };
}

function createRecentProject(
  name: string,
  filePath = `C:\\projects\\${name}.cssproj`,
): RecentProject {
  const project = createNewProject(name);

  return {
    filePath,
    projectId: project.projectId,
    name,
    lastUsedAt: '2026-09-19T03:00:00.000Z',
  };
}

describe('useProjectController', () => {
  it('blocks concurrent exports and reports success', async () => {
    let progressListener: ((progress: unknown) => void) | undefined;
    const cleanupProgress = vi.fn();
    desktopApi.onExportProgress.mockImplementation((listener) => {
      progressListener = listener;
      return cleanupProgress;
    });
    let finishExport: ((value: { status: 'success'; filePath: string }) => void) | undefined;
    desktopApi.exportMp4.mockReturnValue(new Promise((resolve) => { finishExport = resolve; }));
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    let firstExport: Promise<void>;
    act(() => {
      firstExport = result.current.exportMp4();
      void result.current.exportMp4();
    });
    expect(result.current.exportStatus).toBe('exporting');
    expect(result.current.exportProgress).toEqual({ stage: 'preparing' });
    expect(desktopApi.onExportProgress.mock.invocationCallOrder[0]).toBeLessThan(
      desktopApi.exportMp4.mock.invocationCallOrder[0],
    );
    expect(desktopApi.exportMp4).toHaveBeenCalledTimes(1);
    expect(desktopApi.exportMp4).toHaveBeenCalledWith(initialState.project);

    act(() => {
      progressListener?.({ stage: 'scene', sceneIndex: 2, sceneCount: 3 });
    });
    expect(result.current.exportProgress).toEqual({
      stage: 'scene',
      sceneIndex: 2,
      sceneCount: 3,
    });

    await act(async () => {
      finishExport?.({ status: 'success', filePath: 'C:\\exports\\video.mp4' });
      await firstExport;
    });
    expect(result.current.exportStatus).toBe('success');
    expect(result.current.exportProgress).toEqual({ stage: 'complete' });
    expect(cleanupProgress).toHaveBeenCalledOnce();
    expect(desktopApi.onExportProgress).toHaveBeenCalledOnce();
  });

  it('returns to idle on canceled export and reports failures', async () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    desktopApi.onExportProgress
      .mockReturnValueOnce(firstCleanup)
      .mockReturnValueOnce(secondCleanup);
    const { result } = renderHook(() => useProjectController(createSceneState()));
    await act(async () => { await result.current.exportMp4(); });
    expect(result.current.exportStatus).toBe('idle');
    expect(result.current.exportProgress).toBeNull();
    expect(firstCleanup).toHaveBeenCalledOnce();

    desktopApi.exportMp4.mockRejectedValue(new Error('ffmpeg failed'));
    await act(async () => { await result.current.exportMp4(); });
    expect(result.current.exportStatus).toBe('error');
    expect(result.current.exportProgress).toBeNull();
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it('keeps active export progress visible when the project is replaced', async () => {
    let progressListener: ((progress: unknown) => void) | undefined;
    desktopApi.onExportProgress.mockImplementation((listener) => {
      progressListener = listener;
      return vi.fn();
    });
    let finishExport: ((value: { status: 'success'; filePath: string }) => void) | undefined;
    desktopApi.exportMp4.mockReturnValue(new Promise((resolve) => {
      finishExport = resolve;
    }));
    const { result } = renderHook(() => useProjectController(createSceneState()));

    let activeExport: Promise<void>;
    act(() => {
      activeExport = result.current.exportMp4();
      progressListener?.({ stage: 'muxing-audio' });
      result.current.newProject();
    });

    expect(result.current.exportStatus).toBe('exporting');
    expect(result.current.exportProgress).toEqual({ stage: 'muxing-audio' });

    await act(async () => {
      finishExport?.({ status: 'success', filePath: 'C:\\exports\\video.mp4' });
      await activeExport;
    });
    expect(result.current.exportStatus).toBe('success');
    expect(result.current.exportProgress).toEqual({ stage: 'complete' });
  });

  it('adds selected media to the project and marks it dirty', async () => {
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
    const initialState = createState({
      dirty: false,
      project: {
        ...createNewProject('import project'),
        updatedAt: '2026-09-19T00:00:00.000Z',
      },
    });
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.importMedia();
    });

    expect(result.current.state.project.media).toEqual([
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
    expect(result.current.state.project.scenes).toEqual([
      { mediaId: 'photo-id', durationMs: 3000, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
      { mediaId: 'video-id', durationMs: null, subtitle: '', subtitlePosition: 'bottom', subtitleSize: 'medium' },
    ]);
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
  });

  it('moves scenes up and down and updates project edit state', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.moveScene(1, 'up');
    });
    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'middle-video',
      'first-image',
      'last-image',
    ]);

    act(() => {
      result.current.moveScene(1, 'down');
    });
    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'middle-video',
      'last-image',
      'first-image',
    ]);
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
  });

  it('duplicates one scene immediately after its source as a separate object', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));
    let duplicated = false;

    act(() => {
      duplicated = result.current.duplicateScene(0);
    });

    expect(duplicated).toBe(true);
    expect(result.current.state.project.scenes).toHaveLength(4);
    expect(result.current.state.project.scenes[1]).toEqual({
      mediaId: 'first-image',
      durationMs: 3000,
      subtitle: '첫 장면',
      subtitlePosition: 'bottom',
      subtitleSize: 'medium',
    });
    expect(result.current.state.project.scenes[1]).not.toBe(
      result.current.state.project.scenes[0],
    );
    expect(result.current.state.project.scenes.slice(2)).toEqual(
      initialState.project.scenes.slice(1),
    );
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
  });

  it.each([-1, 3])('does not change state when duplicating invalid index %s', (sceneIndex) => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));
    let duplicated = true;

    act(() => {
      duplicated = result.current.duplicateScene(sceneIndex);
    });

    expect(duplicated).toBe(false);
    expect(result.current.state).toBe(initialState);
  });

  it('selects and replaces one narration while updating project edit state', async () => {
    desktopApi.openNarrationDialog
      .mockResolvedValueOnce({
        sourcePath: 'C:\\audio\\first.mp3',
        fileName: 'first.mp3',
      })
      .mockResolvedValueOnce({
        sourcePath: 'C:\\audio\\replacement.wav',
        fileName: 'replacement.wav',
      });
    const initialState = createState({
      dirty: false,
      project: {
        ...createNewProject('narration project'),
        updatedAt: '2026-09-19T00:00:00.000Z',
      },
    });
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.selectNarration();
    });
    expect(result.current.state.project.narration).toEqual({
      sourcePath: 'C:\\audio\\first.mp3',
      fileName: 'first.mp3',
    });
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );

    await act(async () => {
      await result.current.selectNarration();
    });
    expect(result.current.state.project.narration).toEqual({
      sourcePath: 'C:\\audio\\replacement.wav',
      fileName: 'replacement.wav',
    });
  });

  it('leaves the project unchanged when narration selection is cancelled', async () => {
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;

    await act(async () => {
      await result.current.selectNarration();
    });

    expect(result.current.state).toBe(initialState);
  });

  it('removes narration and marks the project as edited', () => {
    const initialState = createState({
      dirty: false,
      project: {
        ...createNewProject('narration project'),
        updatedAt: '2026-09-19T00:00:00.000Z',
        narration: {
          sourcePath: 'C:\\audio\\voice.mp3',
          fileName: 'voice.mp3',
        },
      },
    });
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.removeNarration();
    });

    expect(result.current.state.project.narration).toBeNull();
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
  });

  it('keeps the same state when narration is already absent', () => {
    const initialState = createState({ dirty: false });
    const { result } = renderHook(() => useProjectController(initialState));
    const stateBeforeRemoval = result.current.state;

    act(() => {
      result.current.removeNarration();
    });

    expect(result.current.state).toBe(stateBeforeRemoval);
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.project.updatedAt).toBe(
      initialState.project.updatedAt,
    );
  });

  it('does not change state when moving a scene beyond either boundary', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.moveScene(0, 'up');
      result.current.moveScene(2, 'down');
    });

    expect(result.current.state).toBe(initialState);
  });

  it('removes one scene and its media asset while keeping the others', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));
    vi.clearAllMocks();

    act(() => {
      result.current.deleteScene(1);
    });

    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'first-image',
      'last-image',
    ]);
    expect(result.current.state.project.media.map(({ id }) => id)).toEqual([
      'first-image',
      'last-image',
    ]);
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
    expect(desktopApi.checkProjectSources).toHaveBeenCalledOnce();
    for (const [name, apiMethod] of Object.entries(desktopApi)) {
      if (name === 'checkProjectSources') {
        continue;
      }
      expect(apiMethod).not.toHaveBeenCalled();
    }
  });

  it('keeps shared media until its final scene reference is deleted', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.duplicateScene(0);
      result.current.deleteScene(0);
    });

    expect(result.current.state.project.scenes[0].mediaId).toBe('first-image');
    expect(result.current.state.project.media.some(({ id }) => id === 'first-image')).toBe(true);

    act(() => {
      result.current.deleteScene(0);
    });

    expect(result.current.state.project.scenes.some(({ mediaId }) => mediaId === 'first-image')).toBe(false);
    expect(result.current.state.project.media.some(({ id }) => id === 'first-image')).toBe(false);
  });

  it('edits and moves only one of two scenes that share a media asset', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.duplicateScene(0);
      result.current.updateSceneDuration(1, 4500);
      result.current.updateSceneSubtitle(1, '복제 자막');
      result.current.updateSceneSubtitlePosition(1, 'top');
      result.current.updateSceneSubtitleSize(1, 'large');
    });

    expect(result.current.state.project.scenes[0]).toEqual(
      initialState.project.scenes[0],
    );
    expect(result.current.state.project.scenes[1]).toMatchObject({
      mediaId: 'first-image',
      durationMs: 4500,
      subtitle: '복제 자막',
      subtitlePosition: 'top',
      subtitleSize: 'large',
    });

    act(() => {
      result.current.moveScene(1, 'down');
    });

    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'first-image',
      'middle-video',
      'first-image',
      'last-image',
    ]);
    expect(result.current.state.project.scenes[2].subtitle).toBe('복제 자막');
  });

  it('changes image duration but does not allow changing video duration', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.updateSceneDuration(0, 4500);
    });
    expect(result.current.state.project.scenes[0]).toEqual({
      mediaId: 'first-image',
      durationMs: 4500,
      subtitle: '첫 장면',
      subtitlePosition: 'bottom',
      subtitleSize: 'medium',
    });

    const afterImageChange = result.current.state;
    act(() => {
      result.current.updateSceneDuration(1, 5000);
    });
    expect(result.current.state).toBe(afterImageChange);
  });

  it('changes one scene subtitle and updates project edit state', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.updateSceneSubtitle(1, '새 자막');
    });

    expect(result.current.state.project.scenes[1]).toEqual({
      mediaId: 'middle-video',
      durationMs: null,
      subtitle: '새 자막',
      subtitlePosition: 'bottom',
      subtitleSize: 'medium',
    });
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );

    const afterChange = result.current.state;
    act(() => {
      result.current.updateSceneSubtitle(1, '새 자막');
      result.current.updateSceneSubtitle(99, '무시');
    });
    expect(result.current.state).toBe(afterChange);
  });

  it('changes one scene subtitle style and ignores identical or missing updates', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.updateSceneSubtitlePosition(1, 'top');
      result.current.updateSceneSubtitleSize(1, 'large');
    });

    expect(result.current.state.project.scenes[1]).toMatchObject({
      subtitlePosition: 'top',
      subtitleSize: 'large',
    });
    expect(result.current.state.project.scenes[0]).toBe(
      initialState.project.scenes[0],
    );
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );

    const afterChange = result.current.state;
    act(() => {
      result.current.updateSceneSubtitlePosition(1, 'top');
      result.current.updateSceneSubtitleSize(1, 'large');
      result.current.updateSceneSubtitlePosition(99, 'center');
      result.current.updateSceneSubtitleSize(99, 'small');
    });
    expect(result.current.state).toBe(afterChange);
  });

  it('leaves the project unchanged when media selection is cancelled', async () => {
    desktopApi.openMediaDialog.mockResolvedValue([]);
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;

    await act(async () => {
      await result.current.importMedia();
    });

    expect(result.current.state).toEqual(initialState);
  });

  it('loads an empty recent-project list without changing project state', async () => {
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;

    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    expect(result.current.recentProjects).toEqual([]);
    expect(result.current.recentProjectsListFailed).toBe(false);
    expect(result.current.state).toEqual(initialState);
  });

  it('loads recent projects and retries a failed list without blocking state', async () => {
    const recentProject = createRecentProject('재시도 최근 프로젝트');
    desktopApi.listRecentProjects
      .mockRejectedValueOnce(new Error('list failed'))
      .mockResolvedValueOnce([recentProject]);
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;

    await waitFor(() => {
      expect(result.current.recentProjectsListFailed).toBe(true);
    });
    expect(result.current.recentProjectsLoading).toBe(false);
    expect(result.current.state).toEqual(initialState);

    await act(async () => {
      await result.current.retryRecentProjects();
    });

    expect(result.current.recentProjects).toEqual([recentProject]);
    expect(result.current.recentProjectsListFailed).toBe(false);
  });

  it('opens a recent project with the same clean state as normal Open', async () => {
    const recentProject = createRecentProject('최근 열기');
    const project = createNewProject('최근 열기');
    desktopApi.listRecentProjects.mockResolvedValue([recentProject]);
    desktopApi.openRecentProject.mockResolvedValue({
      status: 'opened',
      project,
      filePath: recentProject.filePath,
    });
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjects).toEqual([recentProject]);
    });

    await act(async () => {
      await result.current.openRecentProject(recentProject.filePath);
    });

    expect(result.current.state).toEqual({
      project,
      filePath: recentProject.filePath,
      dirty: false,
      lastSavedAt: null,
    });
    expect(result.current.recentProjectOpenError).toBeNull();
  });

  it('keeps active state and applies the returned list when a recent file is missing', async () => {
    const missingProject = createRecentProject('사라진 최근 프로젝트');
    const remainingProject = createRecentProject('남은 최근 프로젝트');
    desktopApi.listRecentProjects.mockResolvedValue([missingProject]);
    desktopApi.openRecentProject.mockResolvedValue({
      status: 'missing',
      recentProjects: [remainingProject],
    });
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;
    await waitFor(() => {
      expect(result.current.recentProjects).toEqual([missingProject]);
    });

    await act(async () => {
      await result.current.openRecentProject(missingProject.filePath);
    });

    expect(result.current.state).toEqual(initialState);
    expect(result.current.recentProjects).toEqual([remainingProject]);
    expect(result.current.recentProjectOpenError).toBe('missing');
  });

  it('keeps active state and recent items when opening a recent project fails', async () => {
    const recentProject = createRecentProject('열기 실패 최근 프로젝트');
    desktopApi.listRecentProjects.mockResolvedValue([recentProject]);
    desktopApi.openRecentProject.mockRejectedValue(new Error('read failed'));
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;
    await waitFor(() => {
      expect(result.current.recentProjects).toEqual([recentProject]);
    });

    await act(async () => {
      await result.current.openRecentProject(recentProject.filePath);
    });

    expect(result.current.state).toEqual(initialState);
    expect(result.current.recentProjects).toEqual([recentProject]);
    expect(result.current.recentProjectOpenError).toBe('open');
  });

  it('removes one recent project using the returned list', async () => {
    const removedProject = createRecentProject('제거할 최근 프로젝트');
    const remainingProject = createRecentProject('남길 최근 프로젝트');
    desktopApi.listRecentProjects.mockResolvedValue([
      removedProject,
      remainingProject,
    ]);
    desktopApi.removeRecentProject.mockResolvedValue([remainingProject]);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjects).toHaveLength(2);
    });

    await act(async () => {
      await result.current.removeRecentProject(removedProject.filePath);
    });

    expect(result.current.recentProjects).toEqual([remainingProject]);
    expect(result.current.recentProjectRemoveError).toBe(false);
  });

  it('keeps recent projects and reports when removal fails', async () => {
    const recentProject = createRecentProject('제거 실패 최근 프로젝트');
    desktopApi.listRecentProjects.mockResolvedValue([recentProject]);
    desktopApi.removeRecentProject.mockRejectedValue(new Error('remove failed'));
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjects).toEqual([recentProject]);
    });

    await act(async () => {
      await result.current.removeRecentProject(recentProject.filePath);
    });

    expect(result.current.recentProjects).toEqual([recentProject]);
    expect(result.current.recentProjectRemoveError).toBe(true);
  });

  it('refreshes recent projects after a normal Open succeeds', async () => {
    const project = createNewProject('일반 열기');
    const recentProject: RecentProject = {
      filePath: 'C:\\projects\\opened.cssproj',
      projectId: project.projectId,
      name: project.name,
      lastUsedAt: '2026-09-19T03:00:00.000Z',
    };
    desktopApi.listRecentProjects
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recentProject]);
    desktopApi.openProjectDialog.mockResolvedValue(recentProject.filePath);
    desktopApi.readProject.mockResolvedValue(project);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    await act(async () => {
      await result.current.openProject();
    });

    expect(result.current.recentProjects).toEqual([recentProject]);
    expect(desktopApi.listRecentProjects).toHaveBeenCalledTimes(2);
  });

  it('refreshes recent projects after Save As succeeds', async () => {
    const recentProject = createRecentProject(
      '새 프로젝트',
      'C:\\projects\\saved.cssproj',
    );
    desktopApi.listRecentProjects
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recentProject]);
    desktopApi.saveProjectDialog.mockResolvedValue(recentProject.filePath);
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    await act(async () => {
      await result.current.saveProject();
    });

    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.filePath).toBe(recentProject.filePath);
    expect(result.current.recentProjects).toEqual([recentProject]);
  });

  it('keeps a successful Save clean when refreshing recent projects fails', async () => {
    desktopApi.listRecentProjects
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('recent refresh failed'));
    desktopApi.writeProject.mockResolvedValue(undefined);
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));
    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    await act(async () => {
      await result.current.saveProject();
    });

    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.filePath).toBe(initialState.filePath);
    expect(result.current.state.lastSavedAt).toEqual(expect.any(String));
    expect(result.current.recentProjectsListFailed).toBe(true);
  });

  it('exposes an empty recovery list without changing the initial project', async () => {
    const { result } = renderHook(() => useProjectController());
    const initialProject = result.current.state.project;

    await waitFor(() => {
      expect(result.current.recoveryCandidates).toEqual([]);
    });

    expect(result.current.state.project).toEqual(initialProject);
    expect(result.current.recoveryListFailed).toBe(false);
  });

  it('exposes single and multiple recovery candidates in received order', async () => {
    const newerCandidate = createRecoveryCandidate('최신 복구');
    const olderCandidate = createRecoveryCandidate('이전 복구');
    desktopApi.listRecoveries.mockResolvedValue([
      newerCandidate,
      olderCandidate,
    ]);
    const { result } = renderHook(() => useProjectController());

    await waitFor(() => {
      expect(result.current.recoveryCandidates).toEqual([
        newerCandidate,
        olderCandidate,
      ]);
    });
  });

  it('recovers a candidate as an unsaved dirty project without deleting it', async () => {
    const candidate = createRecoveryCandidate('복구할 프로젝트');
    desktopApi.listRecoveries.mockResolvedValue([candidate]);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recoveryCandidates).toEqual([candidate]);
    });

    act(() => {
      result.current.recoverProject(candidate);
    });

    expect(result.current.state).toEqual({
      project: candidate.project,
      filePath: null,
      dirty: true,
      lastSavedAt: null,
    });
    expect(result.current.recoveryCandidates).toEqual([]);
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
  });

  it('discards only the selected candidate without changing project state', async () => {
    const firstCandidate = createRecoveryCandidate('첫 복구');
    const secondCandidate = createRecoveryCandidate('두 번째 복구');
    desktopApi.listRecoveries.mockResolvedValue([
      firstCandidate,
      secondCandidate,
    ]);
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;
    await waitFor(() => {
      expect(result.current.recoveryCandidates).toHaveLength(2);
    });

    await act(async () => {
      await result.current.discardRecovery(firstCandidate.projectId);
    });

    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(
      firstCandidate.projectId,
    );
    expect(result.current.recoveryCandidates).toEqual([secondCandidate]);
    expect(result.current.state).toEqual(initialState);
  });

  it('keeps a candidate and exposes its id when discard fails', async () => {
    const candidate = createRecoveryCandidate('삭제 실패 복구');
    desktopApi.listRecoveries.mockResolvedValue([candidate]);
    desktopApi.deleteRecovery.mockRejectedValue(new Error('delete failed'));
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;
    await waitFor(() => {
      expect(result.current.recoveryCandidates).toEqual([candidate]);
    });

    await act(async () => {
      await result.current.discardRecovery(candidate.projectId);
    });

    expect(result.current.recoveryCandidates).toEqual([candidate]);
    expect(result.current.discardFailedProjectId).toBe(candidate.projectId);
    expect(result.current.state).toEqual(initialState);
  });

  it('distinguishes list failure and retries successfully', async () => {
    const candidate = createRecoveryCandidate('재시도 복구');
    desktopApi.listRecoveries
      .mockRejectedValueOnce(new Error('list failed'))
      .mockResolvedValueOnce([candidate]);
    const { result } = renderHook(() => useProjectController());

    await waitFor(() => {
      expect(result.current.recoveryListFailed).toBe(true);
    });
    expect(result.current.recoveryCandidates).toBeNull();

    await act(async () => {
      await result.current.retryRecoveryList();
    });

    expect(result.current.recoveryListFailed).toBe(false);
    expect(result.current.recoveryCandidates).toEqual([candidate]);
    expect(desktopApi.listRecoveries).toHaveBeenCalledTimes(2);
  });

  it('creates a clean new project', () => {
    const { result } = renderHook(() => useProjectController());

    act(() => {
      result.current.newProject();
    });

    expect(result.current.state.project.name).toBe('새 프로젝트');
    expect(result.current.state.filePath).toBeNull();
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.lastSavedAt).toBeNull();
  });

  it('leaves state unchanged when opening is cancelled', async () => {
    desktopApi.openProjectDialog.mockResolvedValue(null);
    const { result } = renderHook(() => useProjectController());
    const initialState = result.current.state;

    await act(async () => {
      await result.current.openProject();
    });

    expect(result.current.state).toEqual(initialState);
    expect(result.current.projectOpenError).toBe(false);
    expect(desktopApi.readProject).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', new SyntaxError('Unexpected token')],
    ['invalid schema', new Error('유효하지 않은 프로젝트 파일입니다.')],
  ])(
    'keeps the existing dirty project and reports a general Open error for %s',
    async (_label, readError) => {
      const initialState = createState({
        lastSavedAt: '2026-09-19T04:00:00.000Z',
      });
      desktopApi.openProjectDialog.mockResolvedValue(
        'C:\\projects\\invalid.cssproj',
      );
      desktopApi.readProject.mockRejectedValueOnce(readError);
      const { result } = renderHook(() =>
        useProjectController(initialState),
      );

      await act(async () => {
        await result.current.openProject();
      });

      expect(result.current.state).toEqual(initialState);
      expect(result.current.projectOpenError).toBe(true);
    },
  );

  it('clears a general Open error when a later Open succeeds', async () => {
    const initialState = createState();
    const openedProject = createNewProject('오류 후 열린 프로젝트');
    const openedPath = 'C:\\projects\\opened-after-error.cssproj';
    desktopApi.openProjectDialog.mockResolvedValue(openedPath);
    desktopApi.readProject
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(openedProject);
    const { result } = renderHook(() =>
      useProjectController(initialState),
    );
    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    await act(async () => {
      await result.current.openProject();
    });
    expect(result.current.projectOpenError).toBe(true);
    expect(result.current.state).toEqual(initialState);

    await act(async () => {
      await result.current.openProject();
    });

    expect(result.current.projectOpenError).toBe(false);
    expect(result.current.state).toEqual({
      project: openedProject,
      filePath: openedPath,
      dirty: false,
      lastSavedAt: null,
    });
    expect(desktopApi.listRecentProjects).toHaveBeenCalledTimes(2);
  });

  it('loads a selected project as clean state', async () => {
    const project = createNewProject('열린 프로젝트');
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\opened.cssproj');
    desktopApi.readProject.mockResolvedValue(project);
    const { result } = renderHook(() => useProjectController());

    await act(async () => {
      await result.current.openProject();
    });

    expect(result.current.state).toEqual({
      project,
      filePath: 'C:\\projects\\opened.cssproj',
      dirty: false,
      lastSavedAt: null,
    });
    expect(result.current.projectOpenError).toBe(false);
  });

  it('saves as when there is no current file path', async () => {
    desktopApi.saveProjectDialog.mockResolvedValue('C:\\projects\\saved.cssproj');
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectController());

    await act(async () => {
      await result.current.saveProject();
    });

    expect(desktopApi.saveProjectDialog).toHaveBeenCalledWith('새 프로젝트');
    expect(desktopApi.writeProject).toHaveBeenCalledWith(
      'C:\\projects\\saved.cssproj',
      expect.objectContaining({ name: '새 프로젝트' }),
    );
    expect(result.current.state.filePath).toBe('C:\\projects\\saved.cssproj');
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.lastSavedAt).toEqual(expect.any(String));
    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(
      result.current.state.project.projectId,
    );
  });

  it('saves to an existing file path without opening a dialog', async () => {
    const project = createNewProject('기존 경로 프로젝트');
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\existing.cssproj');
    desktopApi.readProject.mockResolvedValue(project);
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    await act(async () => {
      await result.current.openProject();
    });
    await act(async () => {
      await result.current.saveProject();
    });

    expect(desktopApi.saveProjectDialog).not.toHaveBeenCalled();
    expect(desktopApi.writeProject).toHaveBeenCalledWith(
      'C:\\projects\\existing.cssproj',
      project,
    );
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.lastSavedAt).toEqual(expect.any(String));
    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(project.projectId);
    expect(desktopApi.listRecentProjects).toHaveBeenCalledTimes(3);
    expect(result.current.projectSaveStatus).toBe('success');
  });

  it('reports saving, then success, and clears successful feedback', async () => {
    vi.useFakeTimers();
    let finishWrite: (() => void) | undefined;
    desktopApi.writeProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useProjectController(createState({ dirty: false })),
    );

    let savePromise: Promise<void>;
    act(() => {
      savePromise = result.current.saveProject();
    });
    expect(result.current.projectSaveStatus).toBe('saving');

    await act(async () => {
      finishWrite?.();
      await savePromise;
    });
    expect(result.current.projectSaveStatus).toBe('success');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.projectSaveStatus).toBe('idle');
  });

  it('keeps media imported during Save marked as unsaved', async () => {
    let finishWrite: (() => void) | undefined;
    desktopApi.writeProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'during-save-id',
        kind: 'image',
        sourcePath: 'C:\\media\\during-save.png',
        fileName: 'during-save.png',
      },
    ]);
    const initialState = createState({ dirty: false });
    const { result } = renderHook(() => useProjectController(initialState));

    const savePromise = result.current.saveProject();
    await act(async () => {
      await result.current.importMedia();
    });
    await act(async () => {
      finishWrite?.();
      await savePromise;
    });

    expect(result.current.state.project.media).toHaveLength(1);
    expect(result.current.state.dirty).toBe(true);
  });

  it('saves as to the selected path', async () => {
    desktopApi.saveProjectDialog.mockResolvedValue('C:\\projects\\renamed.cssproj');
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectController());

    await act(async () => {
      await result.current.saveProjectAs();
    });

    expect(desktopApi.saveProjectDialog).toHaveBeenCalledWith('새 프로젝트');
    expect(result.current.state.filePath).toBe('C:\\projects\\renamed.cssproj');
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.lastSavedAt).toEqual(expect.any(String));
    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(
      result.current.state.project.projectId,
    );
    expect(result.current.projectSaveStatus).toBe('success');
  });

  it('keeps media imported during Save As marked as unsaved', async () => {
    let finishWrite: (() => void) | undefined;
    const savedPath = 'C:\\projects\\during-save-as.cssproj';
    desktopApi.saveProjectDialog.mockResolvedValue(savedPath);
    desktopApi.writeProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'during-save-as-id',
        kind: 'video',
        sourcePath: 'C:\\media\\during-save-as.mp4',
        fileName: 'during-save-as.mp4',
      },
    ]);
    const { result } = renderHook(() => useProjectController());

    const savePromise = result.current.saveProjectAs();
    await act(async () => {
      await Promise.resolve();
      await result.current.importMedia();
    });
    await act(async () => {
      finishWrite?.();
      await savePromise;
    });

    expect(result.current.state.filePath).toBe(savedPath);
    expect(result.current.state.project.media).toHaveLength(1);
    expect(result.current.state.dirty).toBe(true);
  });

  it('ignores an older Save As that finishes after a newer Save As', async () => {
    let finishFirstWrite: (() => void) | undefined;
    let finishSecondWrite: (() => void) | undefined;
    const firstPath = 'C:\\projects\\first.cssproj';
    const secondPath = 'C:\\projects\\second.cssproj';
    desktopApi.saveProjectDialog
      .mockResolvedValueOnce(firstPath)
      .mockResolvedValueOnce(secondPath);
    desktopApi.writeProject
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirstWrite = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishSecondWrite = resolve;
        }),
      );
    desktopApi.openMediaDialog.mockResolvedValue([
      {
        id: 'between-saves-id',
        kind: 'image',
        sourcePath: 'C:\\media\\between-saves.jpg',
        fileName: 'between-saves.jpg',
      },
    ]);
    const { result } = renderHook(() => useProjectController());

    const firstSave = result.current.saveProjectAs();
    await waitFor(() => {
      expect(desktopApi.writeProject).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.importMedia();
    });
    const secondSave = result.current.saveProjectAs();
    await waitFor(() => {
      expect(desktopApi.writeProject).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      finishSecondWrite?.();
      await secondSave;
    });
    await act(async () => {
      finishFirstWrite?.();
      await firstSave;
    });

    expect(result.current.state.filePath).toBe(secondPath);
    expect(result.current.state.project.media).toHaveLength(1);
    expect(result.current.state.dirty).toBe(false);
  });

  it('does not delete recovery when Save As is cancelled', async () => {
    desktopApi.saveProjectDialog.mockResolvedValue(null);
    const initialState = createState({ filePath: null });
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.saveProjectAs();
    });

    expect(desktopApi.writeProject).not.toHaveBeenCalled();
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
    expect(desktopApi.listRecentProjects).toHaveBeenCalledTimes(1);
    expect(result.current.projectSaveStatus).toBe('idle');
  });

  it('reports a Save As dialog failure without changing project state', async () => {
    desktopApi.saveProjectDialog.mockRejectedValue(new Error('dialog failed'));
    const initialState = createState({ filePath: null });
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.saveProjectAs();
    });

    expect(result.current.projectSaveStatus).toBe('error');
    expect(result.current.state).toEqual(initialState);
    expect(desktopApi.writeProject).not.toHaveBeenCalled();
  });

  it('does not delete recovery when a manual save fails', async () => {
    const saveError = new Error('save failed');
    desktopApi.writeProject.mockRejectedValue(saveError);
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.saveProject();
    });

    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
    expect(desktopApi.listRecentProjects).toHaveBeenCalledTimes(1);
    expect(result.current.projectSaveStatus).toBe('error');
  });

  it('refreshes recent projects after a recovered project is saved as', async () => {
    const candidate = createRecoveryCandidate('복구 후 저장');
    const savedPath = 'C:\\projects\\recovered-save-as.cssproj';
    const recentProject: RecentProject = {
      filePath: savedPath,
      projectId: candidate.projectId,
      name: candidate.name,
      lastUsedAt: '2026-09-19T04:00:00.000Z',
    };
    desktopApi.listRecoveries.mockResolvedValue([candidate]);
    desktopApi.listRecentProjects
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([recentProject]);
    desktopApi.saveProjectDialog.mockResolvedValue(savedPath);
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectController());
    await waitFor(() => {
      expect(result.current.recoveryCandidates).toEqual([candidate]);
      expect(result.current.recentProjectsLoading).toBe(false);
    });

    act(() => {
      result.current.recoverProject(candidate);
    });
    await act(async () => {
      await result.current.saveProject();
    });

    expect(result.current.state.filePath).toBe(savedPath);
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.recentProjects).toEqual([recentProject]);
    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(candidate.projectId);
  });

  it('keeps a successful manual save clean when recovery deletion fails', async () => {
    desktopApi.writeProject.mockResolvedValue(undefined);
    desktopApi.deleteRecovery.mockRejectedValue(new Error('cleanup failed'));
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.saveProject();
    });

    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.lastSavedAt).toEqual(expect.any(String));
    expect(result.current.state.filePath).toBe(initialState.filePath);
  });

  it('writes dirty recovery once at 30 seconds without changing project state', async () => {
    vi.useFakeTimers();
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(desktopApi.writeRecovery).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledTimes(1);
    expect(desktopApi.writeRecovery).toHaveBeenCalledWith(initialState.project);
    expect(result.current.state).toEqual(initialState);
  });

  it('includes duplicated scenes in the autosave recovery payload', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useProjectController(createSceneState()));

    act(() => {
      result.current.duplicateScene(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledOnce();
    expect(desktopApi.writeRecovery.mock.calls[0][0].scenes).toHaveLength(4);
    expect(desktopApi.writeRecovery.mock.calls[0][0].scenes[1]).toEqual(
      desktopApi.writeRecovery.mock.calls[0][0].scenes[0],
    );
  });

  it('does not write recovery for a clean project across multiple intervals', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useProjectController(createState({ dirty: false })),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    expect(desktopApi.writeRecovery).not.toHaveBeenCalled();
    expect(result.current.state.dirty).toBe(false);
  });

  it('writes recovery again on the next interval while dirty remains true', async () => {
    vi.useFakeTimers();
    const initialState = createState();
    renderHook(() => useProjectController(initialState));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledTimes(2);
  });

  it('clears the recovery interval when unmounted', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useProjectController(createState()));

    unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(desktopApi.writeRecovery).not.toHaveBeenCalled();
  });

  it('does not overlap recovery writes', async () => {
    vi.useFakeTimers();
    let finishRecoveryWrite: (() => void) | undefined;
    desktopApi.writeRecovery.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRecoveryWrite = resolve;
      }),
    );
    renderHook(() => useProjectController(createState()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(desktopApi.writeRecovery).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRecoveryWrite?.();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledTimes(2);
  });

  it('waits for an active recovery write before deleting it after Save', async () => {
    vi.useFakeTimers();
    let finishRecoveryWrite: (() => void) | undefined;
    desktopApi.writeRecovery.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRecoveryWrite = resolve;
      }),
    );
    desktopApi.writeProject.mockResolvedValue(undefined);
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const savePromise = result.current.saveProject();
    await Promise.resolve();

    expect(desktopApi.writeProject).toHaveBeenCalledWith(
      initialState.filePath,
      initialState.project,
    );
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();

    await act(async () => {
      finishRecoveryWrite?.();
      await savePromise;
    });

    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(
      initialState.project.projectId,
    );
    expect(result.current.state.dirty).toBe(false);
  });

  it('keeps a dirty project and its recovery when New is canceled', async () => {
    desktopApi.confirmUnsavedChanges.mockResolvedValue('cancel');
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.newProject();
    });

    expect(desktopApi.confirmUnsavedChanges).toHaveBeenCalledWith('new');
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
  });

  it('deletes recovery before replacing a dirty project on explicit discard', async () => {
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.newProject();
    });

    expect(desktopApi.deleteRecovery).toHaveBeenCalledWith(
      initialState.project.projectId,
    );
    expect(result.current.state.project.projectId).not.toBe(
      initialState.project.projectId,
    );
    expect(result.current.state.dirty).toBe(false);
  });

  it('blocks New and exposes an error when discard recovery cleanup fails', async () => {
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    desktopApi.deleteRecovery.mockRejectedValue(new Error('cleanup failed'));
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.newProject();
    });

    expect(result.current.state).toEqual(initialState);
    expect(result.current.projectTransitionError).toBe(true);
  });

  it('does not confirm or read when the Open file dialog is canceled', async () => {
    desktopApi.openProjectDialog.mockResolvedValue(null);
    const { result } = renderHook(() => useProjectController(createState()));

    await act(async () => {
      await result.current.openProject();
    });

    expect(desktopApi.confirmUnsavedChanges).not.toHaveBeenCalled();
    expect(desktopApi.readProject).not.toHaveBeenCalled();
  });

  it('does not read a selected project when dirty confirmation is canceled', async () => {
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\target.cssproj');
    desktopApi.confirmUnsavedChanges.mockResolvedValue('cancel');
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.openProject();
    });

    expect(desktopApi.readProject).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
  });

  it('preserves current recovery when the selected project cannot be read', async () => {
    desktopApi.openProjectDialog.mockResolvedValue('C:\\projects\\bad.cssproj');
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    desktopApi.readProject.mockRejectedValue(new Error('read failed'));
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.openProject();
    });

    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
    expect(result.current.projectOpenError).toBe(true);
  });

  it('guards repeated transitions while confirmation is pending', async () => {
    let finishConfirmation: ((choice: 'cancel') => void) | undefined;
    desktopApi.confirmUnsavedChanges.mockReturnValue(
      new Promise((resolve) => {
        finishConfirmation = resolve;
      }),
    );
    const { result } = renderHook(() => useProjectController(createState()));

    let firstTransition: void | Promise<void>;
    act(() => {
      firstTransition = result.current.newProject();
      void result.current.newProject();
    });
    expect(desktopApi.confirmUnsavedChanges).toHaveBeenCalledOnce();

    await act(async () => {
      finishConfirmation?.('cancel');
      await firstTransition;
    });
  });

  it('reports explicit save outcomes', async () => {
    desktopApi.writeProject.mockResolvedValue(undefined);
    const existing = renderHook(() => useProjectController(createState()));
    await expect(existing.result.current.saveProject()).resolves.toBe('saved');
    existing.unmount();

    desktopApi.saveProjectDialog.mockResolvedValue(null);
    const unsaved = renderHook(() =>
      useProjectController(createState({ filePath: null })),
    );
    await expect(unsaved.result.current.saveProject()).resolves.toBe('canceled');
  });

  it('allows clean close without confirmation and denies a dirty canceled close', async () => {
    let closeListener: (() => void) | undefined;
    desktopApi.onWindowCloseRequested.mockImplementation((listener) => {
      closeListener = listener;
      return vi.fn();
    });
    const clean = renderHook(() =>
      useProjectController(createState({ dirty: false })),
    );

    await act(async () => {
      closeListener?.();
      await waitFor(() =>
        expect(desktopApi.respondToWindowClose).toHaveBeenCalledWith(true),
      );
    });
    expect(desktopApi.confirmUnsavedChanges).not.toHaveBeenCalled();
    clean.unmount();

    desktopApi.respondToWindowClose.mockClear();
    desktopApi.confirmUnsavedChanges.mockResolvedValue('cancel');
    const dirty = renderHook(() => useProjectController(createState()));
    await act(async () => {
      closeListener?.();
      await waitFor(() =>
        expect(desktopApi.respondToWindowClose).toHaveBeenCalledWith(false),
      );
    });
    dirty.unmount();
  });

  it('waits for an active Save instead of opening a second close confirmation', async () => {
    let finishWrite: (() => void) | undefined;
    let closeListener: (() => void) | undefined;
    desktopApi.writeProject.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    desktopApi.onWindowCloseRequested.mockImplementation((listener) => {
      closeListener = listener;
      return vi.fn();
    });
    const { result } = renderHook(() => useProjectController(createState()));

    const savePromise = result.current.saveProject();
    act(() => closeListener?.());
    expect(desktopApi.confirmUnsavedChanges).not.toHaveBeenCalled();

    await act(async () => {
      finishWrite?.();
      await savePromise;
      await waitFor(() =>
        expect(desktopApi.respondToWindowClose).toHaveBeenCalledWith(true),
      );
    });
  });

  it('does not start autosave while a transition is pending', async () => {
    vi.useFakeTimers();
    let finishConfirmation: ((choice: 'cancel') => void) | undefined;
    desktopApi.confirmUnsavedChanges.mockReturnValue(
      new Promise((resolve) => {
        finishConfirmation = resolve;
      }),
    );
    const { result } = renderHook(() => useProjectController(createState()));

    const transition = result.current.newProject();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(desktopApi.writeRecovery).not.toHaveBeenCalled();

    await act(async () => {
      finishConfirmation?.('cancel');
      await transition;
    });
  });

  it('does not call recent-project IPC when dirty confirmation is canceled', async () => {
    desktopApi.confirmUnsavedChanges.mockResolvedValue('cancel');
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.openRecentProject('C:\\projects\\recent.cssproj');
    });

    expect(desktopApi.openRecentProject).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
  });

  it('waits for an active recovery write before explicit discard cleanup', async () => {
    vi.useFakeTimers();
    let finishRecoveryWrite: (() => void) | undefined;
    desktopApi.writeRecovery.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRecoveryWrite = resolve;
      }),
    );
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    const { result } = renderHook(() => useProjectController(createState()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const transition = result.current.newProject();
    await Promise.resolve();
    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();

    await act(async () => {
      finishRecoveryWrite?.();
      await transition;
    });
    expect(desktopApi.deleteRecovery).toHaveBeenCalledOnce();
  });

  it('denies close when explicit discard recovery cleanup fails', async () => {
    let closeListener: (() => void) | undefined;
    desktopApi.onWindowCloseRequested.mockImplementation((listener) => {
      closeListener = listener;
      return vi.fn();
    });
    desktopApi.confirmUnsavedChanges.mockResolvedValue('discard');
    desktopApi.deleteRecovery.mockRejectedValue(new Error('cleanup failed'));
    const { result } = renderHook(() => useProjectController(createState()));

    await act(async () => {
      closeListener?.();
      await waitFor(() =>
        expect(desktopApi.respondToWindowClose).toHaveBeenCalledWith(false),
      );
    });
    expect(result.current.projectTransitionError).toBe(true);
  });

  it('detects missing project sources without changing dirty or updatedAt', async () => {
    const initialState = createSceneState();
    initialState.project.narration = {
      sourcePath: 'C:\\audio\\voice.wav',
      fileName: 'voice.wav',
    };
    desktopApi.checkProjectSources.mockResolvedValue({
      missingMediaIds: ['middle-video'],
      narrationMissing: true,
    });
    const { result } = renderHook(() => useProjectController(initialState));

    await waitFor(() => {
      expect(result.current.missingMediaIds).toEqual(['middle-video']);
      expect(result.current.narrationMissing).toBe(true);
    });
    expect(result.current.sourceCheckFailed).toBe(false);
    expect(result.current.state.dirty).toBe(false);
    expect(result.current.state.project.updatedAt).toBe(
      initialState.project.updatedAt,
    );
    expect(desktopApi.checkProjectSources).toHaveBeenCalledWith({
      media: initialState.project.media.map(({ id, sourcePath }) => ({
        id,
        sourcePath,
      })),
      narrationSourcePath: 'C:\\audio\\voice.wav',
    });
  });

  it('keeps the editor usable when project source inspection fails', async () => {
    desktopApi.checkProjectSources.mockRejectedValue(new Error('ipc failed'));
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    await waitFor(() => expect(result.current.sourceCheckFailed).toBe(true));
    expect(result.current.missingMediaIds).toEqual([]);
    expect(result.current.narrationMissing).toBe(false);
    expect(result.current.state).toEqual(initialState);
  });

  it('ignores a stale source inspection result after another project opens', async () => {
    let finishFirstCheck:
      | ((result: { missingMediaIds: string[]; narrationMissing: boolean }) => void)
      | undefined;
    desktopApi.checkProjectSources
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirstCheck = resolve;
        }),
      )
      .mockResolvedValueOnce({
        missingMediaIds: ['second-image'],
        narrationMissing: false,
      });
    const firstState = createSceneState();
    const secondProject = createNewProject('second');
    secondProject.media = [
      {
        id: 'second-image',
        kind: 'image',
        sourcePath: 'C:\\media\\second.jpg',
        fileName: 'second.jpg',
      },
    ];
    secondProject.scenes = [
      {
        mediaId: 'second-image',
        durationMs: 3000,
        subtitle: '',
        subtitlePosition: 'bottom',
        subtitleSize: 'medium',
      },
    ];
    desktopApi.openProjectDialog.mockResolvedValue(
      'C:\\projects\\second.cssproj',
    );
    desktopApi.readProject.mockResolvedValue(secondProject);
    const { result } = renderHook(() => useProjectController(firstState));
    await waitFor(() =>
      expect(desktopApi.checkProjectSources).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      await result.current.openProject();
    });
    await waitFor(() =>
      expect(result.current.missingMediaIds).toEqual(['second-image']),
    );
    await act(async () => {
      finishFirstCheck?.({
        missingMediaIds: ['first-image'],
        narrationMissing: true,
      });
      await Promise.resolve();
    });

    expect(result.current.state.project).toBe(secondProject);
    expect(result.current.missingMediaIds).toEqual(['second-image']);
    expect(result.current.narrationMissing).toBe(false);
  });

  it('relinks one media asset while preserving its identity and every scene', async () => {
    const initialState = createSceneState();
    initialState.project.scenes = [
      initialState.project.scenes[0],
      {
        ...initialState.project.scenes[0],
        subtitle: 'shared asset',
      },
      ...initialState.project.scenes.slice(1),
    ];
    desktopApi.checkProjectSources
      .mockResolvedValueOnce({
        missingMediaIds: ['first-image'],
        narrationMissing: false,
      })
      .mockResolvedValue({ missingMediaIds: [], narrationMissing: false });
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\restored\\renamed.png',
      fileName: 'renamed.png',
    });
    const originalScenes = structuredClone(initialState.project.scenes);
    const untouchedAssets = structuredClone(initialState.project.media.slice(1));
    const { result } = renderHook(() => useProjectController(initialState));
    await waitFor(() =>
      expect(result.current.missingMediaIds).toEqual(['first-image']),
    );

    await act(async () => {
      await result.current.relinkMedia('first-image');
    });

    const relinked = result.current.state.project.media[0];
    expect(desktopApi.relinkSourceFile).toHaveBeenCalledWith(
      'image',
      'C:\\media\\first.jpg',
    );
    expect(relinked).toEqual({
      id: 'first-image',
      kind: 'image',
      sourcePath: 'D:\\restored\\renamed.png',
      fileName: 'renamed.png',
    });
    expect(result.current.state.project.media.slice(1)).toEqual(
      untouchedAssets,
    );
    expect(result.current.state.project.scenes).toEqual(originalScenes);
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      initialState.project.updatedAt,
    );
    await waitFor(() => expect(result.current.missingMediaIds).toEqual([]));
  });

  it('does not mutate the project when media relink is canceled or the asset is absent', async () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.relinkMedia('first-image');
    });
    expect(result.current.state).toEqual(initialState);

    await act(async () => {
      await result.current.relinkMedia('unknown-id');
    });
    expect(desktopApi.relinkSourceFile).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual(initialState);
  });

  it('relinks narration without changing other project data', async () => {
    const initialState = createSceneState();
    initialState.project.narration = {
      sourcePath: 'C:\\audio\\old.mp3',
      fileName: 'old.mp3',
    };
    desktopApi.checkProjectSources
      .mockResolvedValueOnce({ missingMediaIds: [], narrationMissing: true })
      .mockResolvedValue({ missingMediaIds: [], narrationMissing: false });
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\audio\\new.wav',
      fileName: 'new.wav',
    });
    const originalMedia = structuredClone(initialState.project.media);
    const originalScenes = structuredClone(initialState.project.scenes);
    const { result } = renderHook(() => useProjectController(initialState));
    await waitFor(() => expect(result.current.narrationMissing).toBe(true));

    await act(async () => {
      await result.current.relinkNarration();
    });

    expect(desktopApi.relinkSourceFile).toHaveBeenCalledWith(
      'narration',
      'C:\\audio\\old.mp3',
    );
    expect(result.current.state.project.narration).toEqual({
      sourcePath: 'D:\\audio\\new.wav',
      fileName: 'new.wav',
    });
    expect(result.current.state.project.media).toEqual(originalMedia);
    expect(result.current.state.project.scenes).toEqual(originalScenes);
    expect(result.current.state.dirty).toBe(true);
    await waitFor(() => expect(result.current.narrationMissing).toBe(false));
  });

  it('includes relinked media in Save and export payloads', async () => {
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\restored\\saved.jpg',
      fileName: 'saved.jpg',
    });
    desktopApi.writeProject.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useProjectController(createSceneState()),
    );

    await act(async () => {
      await result.current.relinkMedia('first-image');
      await result.current.saveProject();
      await result.current.exportMp4();
    });

    const savedProject = desktopApi.writeProject.mock.calls[0][1];
    expect(savedProject.media[0]).toEqual(
      expect.objectContaining({
        sourcePath: 'D:\\restored\\saved.jpg',
        fileName: 'saved.jpg',
      }),
    );
    expect(desktopApi.exportMp4).toHaveBeenCalledWith(savedProject);
  });

  it('includes relinked narration in the existing autosave payload', async () => {
    vi.useFakeTimers();
    const initialState = createSceneState();
    initialState.project.narration = {
      sourcePath: 'C:\\audio\\old.mp3',
      fileName: 'old.mp3',
    };
    desktopApi.relinkSourceFile.mockResolvedValue({
      sourcePath: 'D:\\audio\\autosaved.wav',
      fileName: 'autosaved.wav',
    });
    const { result } = renderHook(() => useProjectController(initialState));

    await act(async () => {
      await result.current.relinkNarration();
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        narration: {
          sourcePath: 'D:\\audio\\autosaved.wav',
          fileName: 'autosaved.wav',
        },
      }),
    );
  });

  it('applies an auto-shorts scene plan atomically while preserving media and scene identity fields', () => {
    const initialState = createSceneState();
    const projectSnapshot = initialState.project;
    const mediaSnapshot = initialState.project.media;
    const nextScenes = initialState.project.scenes.map((scene, index) => ({
      ...scene,
      subtitle: `자동 자막 ${index + 1}`,
      durationMs: scene.durationMs === null ? null : 4500 + index,
    }));
    const { result } = renderHook(() => useProjectController(initialState));
    let accepted = false;

    act(() => {
      accepted = result.current.applyAutoShorts(projectSnapshot, nextScenes);
    });

    expect(accepted).toBe(true);
    expect(result.current.state.project.media).toBe(mediaSnapshot);
    expect(result.current.state.project.scenes).toEqual(nextScenes);
    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual(
      projectSnapshot.scenes.map(({ mediaId }) => mediaId),
    );
    expect(result.current.state.project.scenes[1].durationMs).toBeNull();
    expect(result.current.state.dirty).toBe(true);
    expect(result.current.state.project.updatedAt).not.toBe(
      projectSnapshot.updatedAt,
    );
  });

  it('accepts an unchanged value snapshot instead of requiring project object identity', () => {
    const initialState = createSceneState();
    const projectSnapshot = structuredClone(initialState.project);
    const nextScenes = projectSnapshot.scenes.map((scene) => ({
      ...scene,
      subtitle: 'fresh plan',
    }));
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      expect(
        result.current.applyAutoShorts(projectSnapshot, nextScenes),
      ).toBe(true);
    });

    expect(result.current.state.project.scenes[0].subtitle).toBe('fresh plan');
  });

  it('keeps identical and empty auto-shorts plans as no-ops', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));
    const initialProject = result.current.state.project;

    act(() => {
      expect(
        result.current.applyAutoShorts(
          initialProject,
          initialProject.scenes.map((scene) => ({ ...scene })),
        ),
      ).toBe(true);
    });
    expect(result.current.state.project).toBe(initialProject);
    expect(result.current.state.dirty).toBe(false);

    const emptyState = createState({
      dirty: false,
      project: createNewProject('empty'),
    });
    const emptyHook = renderHook(() => useProjectController(emptyState));
    const emptyProject = emptyHook.result.current.state.project;
    act(() => {
      expect(
        emptyHook.result.current.applyAutoShorts(emptyProject, []),
      ).toBe(true);
    });
    expect(emptyHook.result.current.state.project).toBe(emptyProject);
    expect(emptyHook.result.current.state.dirty).toBe(false);
  });

  it.each([
    [
      'scene reorder',
      (controller: ReturnType<typeof useProjectController>) => {
        controller.moveScene(0, 'down');
      },
    ],
    [
      'subtitle edit',
      (controller: ReturnType<typeof useProjectController>) => {
        controller.updateSceneSubtitle(0, 'newer edit');
      },
    ],
    [
      'image duration edit',
      (controller: ReturnType<typeof useProjectController>) => {
        controller.updateSceneDuration(0, 4321);
      },
    ],
    [
      'same-count scene replacement',
      (controller: ReturnType<typeof useProjectController>) => {
        controller.deleteScene(0);
        controller.duplicateScene(0);
      },
    ],
  ])('rejects an auto-shorts plan after %s without another state change', (_label, mutate) => {
    const initialState = createSceneState();
    const staleProject = structuredClone(initialState.project);
    const plannedScenes = staleProject.scenes.map((scene) => ({
      ...scene,
      subtitle: 'stale',
    }));
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      mutate(result.current);
    });
    const stateBeforeApply = result.current.state;

    act(() => {
      expect(
        result.current.applyAutoShorts(staleProject, plannedScenes),
      ).toBe(false);
    });

    expect(result.current.state).toBe(stateBeforeApply);
    expect(result.current.state.project).toBe(stateBeforeApply.project);
    expect(result.current.state.dirty).toBe(stateBeforeApply.dirty);
    expect(result.current.state.project.updatedAt).toBe(
      stateBeforeApply.project.updatedAt,
    );
  });

  it('includes auto-shorts changes in the existing Save and export payloads', async () => {
    desktopApi.writeProject.mockResolvedValue(undefined);
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.applyAutoShorts(
        initialState.project,
        initialState.project.scenes.map((scene) => ({
          ...scene,
          subtitle: '저장할 자동 자막',
        })),
      );
    });
    await act(async () => {
      await result.current.saveProject();
      await result.current.exportMp4();
    });

    const savedProject = desktopApi.writeProject.mock.calls[0][1];
    expect(desktopApi.writeProject).toHaveBeenCalledWith(
      initialState.filePath,
      expect.objectContaining({
        scenes: expect.arrayContaining([
          expect.objectContaining({ subtitle: '저장할 자동 자막' }),
        ]),
      }),
    );
    expect(desktopApi.exportMp4).toHaveBeenCalledWith(savedProject);
  });

  it('includes auto-shorts changes in the existing recovery autosave payload', async () => {
    vi.useFakeTimers();
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.applyAutoShorts(
        initialState.project,
        initialState.project.scenes.map((scene) => ({
          ...scene,
          subtitle: '복구할 자동 자막',
        })),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(desktopApi.writeRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        scenes: expect.arrayContaining([
          expect.objectContaining({ subtitle: '복구할 자동 자막' }),
        ]),
      }),
    );
  });
});
