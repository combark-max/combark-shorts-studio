import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../../src/shared/project/createProject';
import { useProjectController } from '../../../src/renderer/project/useProjectController';
import type { ProjectState } from '../../../src/renderer/project/projectState';
import type { RecoveryCandidate } from '../../../src/shared/project/types';

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
  desktopApi.writeRecovery.mockResolvedValue(undefined);
  desktopApi.deleteRecovery.mockResolvedValue(undefined);
  desktopApi.listRecoveries.mockResolvedValue([]);
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

function createRecoveryCandidate(name: string): RecoveryCandidate {
  const project = createNewProject(name);

  return {
    projectId: project.projectId,
    name,
    modifiedAt: '2026-09-19T01:02:03.000Z',
    project,
  };
}

describe('useProjectController', () => {
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
    expect(desktopApi.readProject).not.toHaveBeenCalled();
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
  });

  it('does not delete recovery when a manual save fails', async () => {
    const saveError = new Error('save failed');
    desktopApi.writeProject.mockRejectedValue(saveError);
    const initialState = createState();
    const { result } = renderHook(() => useProjectController(initialState));

    await expect(result.current.saveProject()).rejects.toBe(saveError);

    expect(desktopApi.deleteRecovery).not.toHaveBeenCalled();
    expect(result.current.state).toEqual(initialState);
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
