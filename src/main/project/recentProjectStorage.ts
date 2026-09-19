import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, win32 } from 'node:path';

import type {
  OpenRecentProjectResult,
  ProjectDocumentV1,
  RecentProject,
  RecentProjectsStoreV1,
} from '../../shared/project/types';
import { validateProjectDocument } from '../../shared/project/validateProject';
import { readProjectFile } from './projectStorage';

const RECENT_PROJECTS_FILE_NAME = 'recent-projects.json';
const MAX_RECENT_PROJECTS = 5;
const STORE_KEYS = ['schemaVersion', 'projects'] as const;
const PROJECT_KEYS = ['filePath', 'projectId', 'name', 'lastUsedAt'] as const;

let mutationQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function getStorePath(userDataPath: string): string {
  return join(userDataPath, RECENT_PROJECTS_FILE_NAME);
}

function normalizeFilePath(filePath: string): string {
  return win32.normalize(filePath).toLocaleLowerCase('en-US');
}

function validateFilePath(filePath: string): void {
  if (
    !win32.isAbsolute(filePath) ||
    win32.extname(filePath).toLocaleLowerCase('en-US') !== '.cssproj'
  ) {
    throw new Error('유효하지 않은 프로젝트 경로입니다.');
  }
}

function validateRecentProject(value: unknown): RecentProject | null {
  if (!isRecord(value) || !hasExactKeys(value, PROJECT_KEYS)) {
    return null;
  }

  if (
    typeof value.filePath !== 'string' ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.lastUsedAt !== 'string' ||
    Number.isNaN(Date.parse(value.lastUsedAt))
  ) {
    return null;
  }

  try {
    validateFilePath(value.filePath);
  } catch {
    return null;
  }

  return {
    filePath: value.filePath,
    projectId: value.projectId,
    name: value.name,
    lastUsedAt: value.lastUsedAt,
  };
}

function validateStore(value: unknown): RecentProjectsStoreV1 | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, STORE_KEYS) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.projects)
  ) {
    return null;
  }

  const projects = value.projects.map(validateRecentProject);

  if (projects.some((project) => project === null)) {
    return null;
  }

  return {
    schemaVersion: 1,
    projects: (projects as RecentProject[])
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
      .slice(0, MAX_RECENT_PROJECTS),
  };
}

async function readStore(userDataPath: string): Promise<RecentProjectsStoreV1> {
  let contents: string;

  try {
    contents = await readFile(getStorePath(userDataPath), 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { schemaVersion: 1, projects: [] };
    }

    throw error;
  }

  try {
    const value: unknown = JSON.parse(contents);
    return validateStore(value) ?? { schemaVersion: 1, projects: [] };
  } catch {
    return { schemaVersion: 1, projects: [] };
  }
}

async function writeStoreAtomic(
  userDataPath: string,
  store: RecentProjectsStoreV1,
): Promise<void> {
  await mkdir(userDataPath, { recursive: true });
  const storePath = getStorePath(userDataPath);
  const temporaryPath = join(
    userDataPath,
    `${RECENT_PROJECTS_FILE_NAME}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  const contents = `${JSON.stringify(store, null, 2)}\n`;
  let fileHandle: FileHandle | undefined;

  try {
    fileHandle = await open(temporaryPath, 'wx');
    await fileHandle.writeFile(contents, 'utf8');
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(temporaryPath, storePath);
  } catch (error) {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Preserve the original storage error.
      }
    }

    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Preserve the original storage error.
    }

    throw error;
  }
}

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    (): void => undefined,
    (): void => undefined,
  );
  return result;
}

export async function listRecentProjects(
  userDataPath: string,
): Promise<RecentProject[]> {
  return (await readStore(userDataPath)).projects;
}

export function recordRecentProject(
  userDataPath: string,
  filePath: string,
  project: ProjectDocumentV1,
): Promise<RecentProject[]> {
  return enqueueMutation(async () => {
    validateFilePath(filePath);
    const validatedProject = validateProjectDocument(project);
    const currentProjects = (await readStore(userDataPath)).projects;
    const normalizedFilePath = normalizeFilePath(filePath);
    const recentProject: RecentProject = {
      filePath,
      projectId: validatedProject.projectId,
      name: validatedProject.name,
      lastUsedAt: new Date().toISOString(),
    };
    const projects = [
      recentProject,
      ...currentProjects.filter(
        (currentProject) =>
          currentProject.projectId !== recentProject.projectId &&
          normalizeFilePath(currentProject.filePath) !== normalizedFilePath,
      ),
    ].slice(0, MAX_RECENT_PROJECTS);

    await writeStoreAtomic(userDataPath, { schemaVersion: 1, projects });
    return projects;
  });
}

function removeRecentProject(
  userDataPath: string,
  filePath: string,
): Promise<RecentProject[]> {
  return enqueueMutation(async () => {
    const normalizedFilePath = normalizeFilePath(filePath);
    const currentProjects = (await readStore(userDataPath)).projects;
    const projects = currentProjects.filter(
      (project) => normalizeFilePath(project.filePath) !== normalizedFilePath,
    );

    if (projects.length !== currentProjects.length) {
      await writeStoreAtomic(userDataPath, { schemaVersion: 1, projects });
    }

    return projects;
  });
}

export async function openRecentProjectFile(
  userDataPath: string,
  filePath: string,
): Promise<OpenRecentProjectResult> {
  validateFilePath(filePath);
  const normalizedFilePath = normalizeFilePath(filePath);
  const recentProjects = await listRecentProjects(userDataPath);
  const recentProject = recentProjects.find(
    (project) => normalizeFilePath(project.filePath) === normalizedFilePath,
  );

  if (!recentProject) {
    throw new Error('최근 프로젝트에 등록되지 않은 경로입니다.');
  }

  let project: ProjectDocumentV1;

  try {
    project = await readProjectFile(recentProject.filePath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return {
        status: 'missing',
        recentProjects: await removeRecentProject(
          userDataPath,
          recentProject.filePath,
        ),
      };
    }

    throw error;
  }

  try {
    await recordRecentProject(userDataPath, recentProject.filePath, project);
  } catch {
    // Recent-project bookkeeping must not fail a successful project open.
  }

  return {
    status: 'opened',
    project,
    filePath: recentProject.filePath,
  };
}
