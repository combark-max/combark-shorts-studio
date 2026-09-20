import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >(),
  getPath: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showSaveDialog: electronMocks.showSaveDialog,
  },
  ipcMain: {
    removeHandler: vi.fn((channel: string) => {
      electronMocks.handlers.delete(channel);
    }),
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => unknown,
      ) => {
        electronMocks.handlers.set(channel, handler);
      },
    ),
  },
}));

import {
  listRecentProjects,
  openRecentProjectFile,
  recordRecentProject,
  removeRecentProject,
} from '../../../src/main/project/recentProjectStorage';
import { writeProjectFileAtomic } from '../../../src/main/project/projectStorage';
import { registerProjectIpc } from '../../../src/main/ipc/registerProjectIpc';
import { createNewProject } from '../../../src/shared/project/createProject';
import { IPC_CHANNELS } from '../../../src/shared/ipc';

let temporaryDirectory: string;
let userDataDirectory: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T01:00:00.000Z'));
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'combark-recent-storage-'));
  userDataDirectory = join(temporaryDirectory, 'user-data');
  await mkdir(userDataDirectory);
  electronMocks.handlers.clear();
  electronMocks.getPath.mockReset();
  electronMocks.getPath.mockReturnValue(userDataDirectory);
  electronMocks.showOpenDialog.mockReset();
  electronMocks.showSaveDialog.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function projectPath(name: string): string {
  return join(temporaryDirectory, `${name}.cssproj`);
}

function getHandler(
  channel: string,
): (event: unknown, ...args: unknown[]) => unknown {
  const handler = electronMocks.handlers.get(channel);

  if (!handler) {
    throw new Error(`Missing IPC handler: ${channel}`);
  }

  return handler;
}

describe('recentProjectStorage', () => {
  it('returns an empty list when the store does not exist', async () => {
    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([]);
  });

  it('removes only the requested recent item without deleting its project file', async () => {
    const removedProject = createNewProject('제거할 프로젝트');
    const remainingProject = createNewProject('남길 프로젝트');
    const removedPath = projectPath('removed');
    const remainingPath = projectPath('remaining');
    await writeProjectFileAtomic(removedPath, removedProject);
    await writeProjectFileAtomic(remainingPath, remainingProject);
    await recordRecentProject(userDataDirectory, removedPath, removedProject);
    await recordRecentProject(userDataDirectory, remainingPath, remainingProject);

    await expect(
      removeRecentProject(userDataDirectory, removedPath),
    ).resolves.toEqual([
      expect.objectContaining({ filePath: remainingPath }),
    ]);

    await expect(readFile(removedPath, 'utf8')).resolves.toContain(
      removedProject.projectId,
    );
    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([
      expect.objectContaining({ filePath: remainingPath }),
    ]);
  });

  it('records the first recent project in a versioned store', async () => {
    const project = createNewProject('첫 최근 프로젝트');
    const filePath = projectPath('first');

    await expect(
      recordRecentProject(userDataDirectory, filePath, project),
    ).resolves.toEqual([
      {
        filePath,
        projectId: project.projectId,
        name: '첫 최근 프로젝트',
        lastUsedAt: '2026-09-19T01:00:00.000Z',
      },
    ]);

    expect(
      JSON.parse(
        await readFile(join(userDataDirectory, 'recent-projects.json'), 'utf8'),
      ),
    ).toEqual({
      schemaVersion: 1,
      projects: [
        {
          filePath,
          projectId: project.projectId,
          name: '첫 최근 프로젝트',
          lastUsedAt: '2026-09-19T01:00:00.000Z',
        },
      ],
    });
  });

  it('keeps multiple projects newest first', async () => {
    const olderProject = createNewProject('이전 프로젝트');
    const newerProject = createNewProject('최신 프로젝트');
    await recordRecentProject(
      userDataDirectory,
      projectPath('older'),
      olderProject,
    );
    vi.setSystemTime(new Date('2026-09-19T02:00:00.000Z'));

    const projects = await recordRecentProject(
      userDataDirectory,
      projectPath('newer'),
      newerProject,
    );

    expect(projects.map(({ projectId }) => projectId)).toEqual([
      newerProject.projectId,
      olderProject.projectId,
    ]);
  });

  it('deduplicates the same file path and moves it to the front', async () => {
    const firstProject = createNewProject('첫 프로젝트');
    const repeatedProject = createNewProject('다시 연 프로젝트');
    const repeatedPath = 'C:\\Projects\\Repeated.cssproj';
    await recordRecentProject(userDataDirectory, repeatedPath, firstProject);
    await recordRecentProject(
      userDataDirectory,
      projectPath('other'),
      createNewProject('다른 프로젝트'),
    );
    vi.setSystemTime(new Date('2026-09-19T03:00:00.000Z'));

    const projects = await recordRecentProject(
      userDataDirectory,
      repeatedPath,
      repeatedProject,
    );

    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({
      filePath: repeatedPath,
      projectId: repeatedProject.projectId,
      name: '다시 연 프로젝트',
      lastUsedAt: '2026-09-19T03:00:00.000Z',
    });
  });

  it('deduplicates Windows paths without regard to case', async () => {
    const firstProject = createNewProject('첫 경로');
    const secondProject = createNewProject('대소문자 변경 경로');
    await recordRecentProject(
      userDataDirectory,
      'C:\\Projects\\Case.cssproj',
      firstProject,
    );

    const projects = await recordRecentProject(
      userDataDirectory,
      'c:\\projects\\CASE.cssproj',
      secondProject,
    );

    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe(secondProject.projectId);
  });

  it('replaces an older path when the same projectId is saved as', async () => {
    const project = createNewProject('다른 이름으로 저장');
    await recordRecentProject(
      userDataDirectory,
      'C:\\Projects\\old.cssproj',
      project,
    );

    const projects = await recordRecentProject(
      userDataDirectory,
      'C:\\Projects\\new.cssproj',
      project,
    );

    expect(projects).toEqual([
      expect.objectContaining({
        filePath: 'C:\\Projects\\new.cssproj',
        projectId: project.projectId,
      }),
    ]);
  });

  it('keeps only the five most recently used projects', async () => {
    for (let index = 0; index < 6; index += 1) {
      vi.setSystemTime(new Date(`2026-09-19T0${index + 1}:00:00.000Z`));
      await recordRecentProject(
        userDataDirectory,
        projectPath(`project-${index}`),
        createNewProject(`프로젝트 ${index}`),
      );
    }

    const projects = await listRecentProjects(userDataDirectory);

    expect(projects).toHaveLength(5);
    expect(projects.map(({ name }) => name)).toEqual([
      '프로젝트 5',
      '프로젝트 4',
      '프로젝트 3',
      '프로젝트 2',
      '프로젝트 1',
    ]);
  });

  it.each([
    ['malformed JSON', '{ invalid json'],
    [
      'an invalid schema',
      JSON.stringify({ schemaVersion: 2, projects: [] }),
    ],
  ])('treats %s as an empty list', async (_label, contents) => {
    await writeFile(
      join(userDataDirectory, 'recent-projects.json'),
      contents,
      'utf8',
    );

    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([]);
  });

  it('propagates an unexpected store read error', async () => {
    await mkdir(join(userDataDirectory, 'recent-projects.json'));

    await expect(listRecentProjects(userDataDirectory)).rejects.toThrow();
  });

  it('writes atomically without leaving temporary files', async () => {
    await recordRecentProject(
      userDataDirectory,
      projectPath('atomic'),
      createNewProject('원자적 저장'),
    );

    expect((await readdir(userDataDirectory)).sort()).toEqual([
      'recent-projects.json',
    ]);
  });

  it('serializes concurrent mutations without losing projects', async () => {
    const projects = Array.from({ length: 5 }, (_, index) => ({
      document: createNewProject(`동시 프로젝트 ${index}`),
      filePath: projectPath(`concurrent-${index}`),
    }));

    await Promise.all(
      projects.map(({ document, filePath }) =>
        recordRecentProject(userDataDirectory, filePath, document),
      ),
    );

    const storedProjects = await listRecentProjects(userDataDirectory);
    expect(storedProjects).toHaveLength(5);
    expect(new Set(storedProjects.map(({ projectId }) => projectId))).toEqual(
      new Set(projects.map(({ document }) => document.projectId)),
    );
  });

  it('rejects a path that is not registered as recent', async () => {
    await expect(
      openRecentProjectFile(userDataDirectory, projectPath('unregistered')),
    ).rejects.toThrow('최근 프로젝트에 등록되지 않은 경로입니다.');
  });

  it('opens a registered project and moves it to the front', async () => {
    const firstProject = createNewProject('첫 프로젝트');
    const secondProject = createNewProject('두 번째 프로젝트');
    const firstPath = projectPath('first-open');
    const secondPath = projectPath('second-open');
    await writeProjectFileAtomic(firstPath, firstProject);
    await writeProjectFileAtomic(secondPath, secondProject);
    await recordRecentProject(userDataDirectory, firstPath, firstProject);
    await recordRecentProject(userDataDirectory, secondPath, secondProject);
    vi.setSystemTime(new Date('2026-09-19T04:00:00.000Z'));

    await expect(
      openRecentProjectFile(userDataDirectory, firstPath),
    ).resolves.toEqual({
      status: 'opened',
      project: firstProject,
      filePath: firstPath,
    });
    expect(
      (await listRecentProjects(userDataDirectory)).map(({ projectId }) =>
        projectId,
      ),
    ).toEqual([firstProject.projectId, secondProject.projectId]);
  });

  it('keeps a successful recent open successful when reordering fails', async () => {
    const project = createNewProject('정렬 기록 실패 프로젝트');
    const filePath = projectPath('reorder-failure');
    await writeProjectFileAtomic(filePath, project);
    await recordRecentProject(userDataDirectory, filePath, project);
    vi.spyOn(Date.prototype, 'toISOString').mockImplementationOnce(() => {
      throw Object.assign(new Error('recent timestamp failed'), {
        code: 'ENOENT',
      });
    });

    await expect(
      openRecentProjectFile(userDataDirectory, filePath),
    ).resolves.toEqual({
      status: 'opened',
      project,
      filePath,
    });
  });

  it('removes only a missing recent project', async () => {
    const missingProject = createNewProject('사라진 프로젝트');
    const remainingProject = createNewProject('남은 프로젝트');
    const missingPath = projectPath('missing');
    const remainingPath = projectPath('remaining');
    await writeProjectFileAtomic(remainingPath, remainingProject);
    await recordRecentProject(userDataDirectory, missingPath, missingProject);
    await recordRecentProject(userDataDirectory, remainingPath, remainingProject);

    await expect(
      openRecentProjectFile(userDataDirectory, missingPath),
    ).resolves.toEqual({
      status: 'missing',
      recentProjects: [
        expect.objectContaining({ projectId: remainingProject.projectId }),
      ],
    });
    expect(await listRecentProjects(userDataDirectory)).toEqual([
      expect.objectContaining({ projectId: remainingProject.projectId }),
    ]);
  });

  it('keeps a recent item when its project is invalid', async () => {
    const project = createNewProject('손상된 프로젝트');
    const filePath = projectPath('invalid-project');
    await recordRecentProject(userDataDirectory, filePath, project);
    await writeFile(filePath, '{ invalid json', 'utf8');

    await expect(
      openRecentProjectFile(userDataDirectory, filePath),
    ).rejects.toThrow();
    expect(await listRecentProjects(userDataDirectory)).toEqual([
      expect.objectContaining({ projectId: project.projectId }),
    ]);
  });

  it('keeps a recent item when its project cannot be read', async () => {
    const project = createNewProject('읽기 실패 프로젝트');
    const filePath = projectPath('unreadable-project');
    await recordRecentProject(userDataDirectory, filePath, project);
    await mkdir(filePath);

    await expect(
      openRecentProjectFile(userDataDirectory, filePath),
    ).rejects.toThrow();
    expect(await listRecentProjects(userDataDirectory)).toEqual([
      expect.objectContaining({ projectId: project.projectId }),
    ]);
  });
});

describe('recent project IPC integration', () => {
  it('records a project only after a normal read succeeds', async () => {
    const project = createNewProject('일반 열기');
    const filePath = projectPath('normal-open');
    await writeProjectFileAtomic(filePath, project);
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectRead)(undefined, filePath),
    ).resolves.toEqual(project);
    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([
      expect.objectContaining({ filePath, projectId: project.projectId }),
    ]);
  });

  it('records a project only after a normal write succeeds', async () => {
    const project = createNewProject('일반 저장');
    const filePath = projectPath('normal-save');
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectWrite)(undefined, filePath, project),
    ).resolves.toBeUndefined();
    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([
      expect.objectContaining({ filePath, projectId: project.projectId }),
    ]);
  });

  it('does not record cancelled or failed project operations', async () => {
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectOpenDialog)(undefined),
    ).resolves.toBeNull();
    await expect(
      getHandler(IPC_CHANNELS.projectRead)(
        undefined,
        projectPath('missing-open'),
      ),
    ).rejects.toThrow();
    await expect(
      getHandler(IPC_CHANNELS.projectWrite)(
        undefined,
        join(temporaryDirectory, 'missing-parent', 'failed.cssproj'),
        createNewProject('실패한 저장'),
      ),
    ).rejects.toThrow();
    await expect(listRecentProjects(userDataDirectory)).resolves.toEqual([]);
  });

  it('keeps successful reads and writes successful when recent recording fails', async () => {
    const project = createNewProject('기록 실패와 무관한 프로젝트');
    const openedPath = projectPath('record-failure-open');
    const savedPath = projectPath('record-failure-save');
    const blockedUserDataPath = join(temporaryDirectory, 'blocked-user-data');
    await writeProjectFileAtomic(openedPath, project);
    await writeFile(blockedUserDataPath, 'not a directory', 'utf8');
    electronMocks.getPath.mockReturnValue(blockedUserDataPath);
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectRead)(undefined, openedPath),
    ).resolves.toEqual(project);
    await expect(
      getHandler(IPC_CHANNELS.projectWrite)(undefined, savedPath, project),
    ).resolves.toBeUndefined();
    await expect(readFile(savedPath, 'utf8')).resolves.toContain(
      '기록 실패와 무관한 프로젝트',
    );
  });

  it('lists and securely opens only registered recent projects', async () => {
    const project = createNewProject('최근 열기');
    const filePath = projectPath('recent-open');
    await writeProjectFileAtomic(filePath, project);
    await recordRecentProject(userDataDirectory, filePath, project);
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectRecentList)(undefined),
    ).resolves.toEqual([
      expect.objectContaining({ filePath, projectId: project.projectId }),
    ]);
    await expect(
      getHandler(IPC_CHANNELS.projectRecentOpen)(undefined, filePath),
    ).resolves.toEqual({ status: 'opened', project, filePath });
    await expect(
      getHandler(IPC_CHANNELS.projectRecentOpen)(
        undefined,
        projectPath('not-registered'),
      ),
    ).rejects.toThrow('최근 프로젝트에 등록되지 않은 경로입니다.');
  });

  it('removes a recent project through IPC without deleting the project file', async () => {
    const project = createNewProject('IPC 제거');
    const filePath = projectPath('ipc-remove');
    await writeProjectFileAtomic(filePath, project);
    await recordRecentProject(userDataDirectory, filePath, project);
    registerProjectIpc();

    await expect(
      getHandler(IPC_CHANNELS.projectRecentRemove)(undefined, filePath),
    ).resolves.toEqual([]);
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      project.projectId,
    );
  });
});
