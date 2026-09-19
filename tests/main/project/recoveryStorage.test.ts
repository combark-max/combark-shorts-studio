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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNewProject } from '../../../src/shared/project/createProject';
import {
  deleteRecoveryFile,
  writeRecoveryFile,
} from '../../../src/main/project/recoveryStorage';

let temporaryDirectory: string;
let userDataDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'combark-recovery-storage-'));
  userDataDirectory = join(temporaryDirectory, 'user-data');
  await mkdir(userDataDirectory);
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('recoveryStorage', () => {
  it('writes a validated project only under the userData recovery directory', async () => {
    const project = createNewProject('복구 저장 테스트');
    const manualProjectPath = join(userDataDirectory, 'manual.cssproj');
    await writeFile(manualProjectPath, 'manual project remains unchanged', 'utf8');

    await writeRecoveryFile(userDataDirectory, project);

    const recoveryFilePath = join(
      userDataDirectory,
      'recovery',
      `${project.projectId}.recovery.json`,
    );
    expect(JSON.parse(await readFile(recoveryFilePath, 'utf8'))).toEqual(project);
    expect(await readFile(manualProjectPath, 'utf8')).toBe(
      'manual project remains unchanged',
    );
    expect((await readdir(userDataDirectory)).sort()).toEqual([
      'manual.cssproj',
      'recovery',
    ]);
  });

  it('deletes the recovery file for a project', async () => {
    const project = createNewProject();
    await writeRecoveryFile(userDataDirectory, project);

    await deleteRecoveryFile(userDataDirectory, project.projectId);

    expect(await readdir(join(userDataDirectory, 'recovery'))).toEqual([]);
  });

  it('allows deleting a recovery file that does not exist', async () => {
    const project = createNewProject();

    await expect(
      deleteRecoveryFile(userDataDirectory, project.projectId),
    ).resolves.toBeUndefined();
  });

  it('uses a separate recovery file for each projectId', async () => {
    const firstProject = createNewProject('첫 프로젝트');
    const secondProject = createNewProject('두 번째 프로젝트');

    await writeRecoveryFile(userDataDirectory, firstProject);
    await writeRecoveryFile(userDataDirectory, secondProject);

    expect((await readdir(join(userDataDirectory, 'recovery'))).sort()).toEqual([
      `${firstProject.projectId}.recovery.json`,
      `${secondProject.projectId}.recovery.json`,
    ].sort());
  });

  it('rejects an unsafe projectId without writing outside the recovery directory', async () => {
    const project = {
      ...createNewProject(),
      projectId: '..\\..\\escaped',
    };

    await expect(writeRecoveryFile(userDataDirectory, project)).rejects.toThrow(
      '안전하지 않은 프로젝트 ID입니다.',
    );
    await expect(
      readFile(join(temporaryDirectory, 'escaped.recovery.json'), 'utf8'),
    ).rejects.toThrow();
    expect(await readdir(userDataDirectory)).toEqual([]);
  });
});
