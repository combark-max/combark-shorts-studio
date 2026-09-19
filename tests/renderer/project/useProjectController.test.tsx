import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../../src/shared/project/createProject';
import { useProjectController } from '../../../src/renderer/project/useProjectController';

const desktopApi = {
  getAppVersion: vi.fn(),
  openProjectDialog: vi.fn(),
  saveProjectDialog: vi.fn(),
  readProject: vi.fn(),
  writeProject: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'combarkDesktop', {
    configurable: true,
    value: desktopApi,
  });
});

describe('useProjectController', () => {
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
  });
});