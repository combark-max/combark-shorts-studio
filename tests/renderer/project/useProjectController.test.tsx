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
  desktopApi.writeRecovery.mockResolvedValue(undefined);
  desktopApi.openMediaDialog.mockResolvedValue([]);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecoveries.mockResolvedValue([]);
  desktopApi.listRecentProjects.mockResolvedValue([]);
  desktopApi.removeRecentProject.mockResolvedValue([]);
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
        { mediaId: 'first-image', durationMs: 3000 },
        { mediaId: 'middle-video', durationMs: null },
        { mediaId: 'last-image', durationMs: 3000 },
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
      { mediaId: 'photo-id', durationMs: 3000 },
      { mediaId: 'video-id', durationMs: null },
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
      result.current.moveScene('middle-video', 'up');
    });
    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'middle-video',
      'first-image',
      'last-image',
    ]);

    act(() => {
      result.current.moveScene('first-image', 'down');
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

  it('does not change state when moving a scene beyond either boundary', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.moveScene('first-image', 'up');
      result.current.moveScene('last-image', 'down');
    });

    expect(result.current.state).toBe(initialState);
  });

  it('deletes only the scene and keeps its media asset', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.deleteScene('middle-video');
    });

    expect(result.current.state.project.scenes.map(({ mediaId }) => mediaId)).toEqual([
      'first-image',
      'last-image',
    ]);
    expect(result.current.state.project.media).toEqual(initialState.project.media);
    expect(result.current.state.dirty).toBe(true);
  });

  it('changes image duration but does not allow changing video duration', () => {
    const initialState = createSceneState();
    const { result } = renderHook(() => useProjectController(initialState));

    act(() => {
      result.current.updateSceneDuration('first-image', 4500);
    });
    expect(result.current.state.project.scenes[0]).toEqual({
      mediaId: 'first-image',
      durationMs: 4500,
    });

    const afterImageChange = result.current.state;
    act(() => {
      result.current.updateSceneDuration('middle-video', 5000);
    });
    expect(result.current.state).toBe(afterImageChange);
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
});
