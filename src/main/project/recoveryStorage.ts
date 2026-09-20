import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ProjectDocument,
  RecoveryCandidate,
} from '../../shared/project/types';
import { validateProjectDocument } from '../../shared/project/validateProject';
import { writeProjectFileAtomic } from './projectStorage';

const SAFE_PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RECOVERY_FILE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.recovery\.json$/;

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function getRecoveryFilePath(
  userDataPath: string,
  projectId: string,
): string {
  if (
    typeof projectId !== 'string' ||
    !SAFE_PROJECT_ID_PATTERN.test(projectId)
  ) {
    throw new Error('안전하지 않은 프로젝트 ID입니다.');
  }

  return join(userDataPath, 'recovery', `${projectId}.recovery.json`);
}

export async function listRecoveryFiles(
  userDataPath: string,
): Promise<RecoveryCandidate[]> {
  const recoveryDirectory = join(userDataPath, 'recovery');
  let fileNames: string[];

  try {
    fileNames = await readdir(recoveryDirectory);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  const candidates = await Promise.all(
    fileNames.map(async (fileName): Promise<RecoveryCandidate | null> => {
      const match = RECOVERY_FILE_PATTERN.exec(fileName);

      if (!match) {
        return null;
      }

      const fileProjectId = match[1];
      const filePath = join(recoveryDirectory, fileName);

      try {
        const contents = await readFile(filePath, 'utf8');
        const value: unknown = JSON.parse(contents);
        const project = validateProjectDocument(value);

        if (project.projectId !== fileProjectId) {
          return null;
        }

        const fileStats = await stat(filePath);

        return {
          projectId: project.projectId,
          name: project.name,
          modifiedAt: fileStats.mtime.toISOString(),
          project,
        };
      } catch {
        return null;
      }
    }),
  );

  return candidates
    .filter((candidate): candidate is RecoveryCandidate => candidate !== null)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function writeRecoveryFile(
  userDataPath: string,
  project: ProjectDocument,
): Promise<void> {
  const validatedProject = validateProjectDocument(project);
  const recoveryFilePath = getRecoveryFilePath(
    userDataPath,
    validatedProject.projectId,
  );

  await mkdir(join(userDataPath, 'recovery'), { recursive: true });
  await writeProjectFileAtomic(recoveryFilePath, validatedProject);
}

export async function deleteRecoveryFile(
  userDataPath: string,
  projectId: string,
): Promise<void> {
  await rm(getRecoveryFilePath(userDataPath, projectId), { force: true });
}
