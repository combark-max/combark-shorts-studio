import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectDocumentV1 } from '../../shared/project/types';
import { validateProjectDocument } from '../../shared/project/validateProject';
import { writeProjectFileAtomic } from './projectStorage';

const SAFE_PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

export async function writeRecoveryFile(
  userDataPath: string,
  project: ProjectDocumentV1,
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
