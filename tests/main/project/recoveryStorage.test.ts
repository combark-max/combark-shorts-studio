import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNewProject } from '../../../src/shared/project/createProject';
import {
  deleteRecoveryFile,
  listRecoveryFiles,
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
  it('returns an empty list when the recovery directory does not exist', async () => {
    await expect(listRecoveryFiles(userDataDirectory)).resolves.toEqual([]);
  });

  it('returns a validated recovery candidate with its modified time', async () => {
    const project = {
      ...createNewProject('복구 후보'),
      media: [
        {
          id: 'recovery-photo-id',
          kind: 'image' as const,
          sourcePath: 'C:\\media\\recovery-photo.webp',
          fileName: 'recovery-photo.webp',
        },
      ],
      scenes: [{ mediaId: 'recovery-photo-id', durationMs: 3000 }],
    };
    const modifiedAt = new Date('2026-09-19T01:02:03.000Z');
    await writeRecoveryFile(userDataDirectory, project);
    await utimes(
      join(userDataDirectory, 'recovery', `${project.projectId}.recovery.json`),
      modifiedAt,
      modifiedAt,
    );

    await expect(listRecoveryFiles(userDataDirectory)).resolves.toEqual([
      {
        projectId: project.projectId,
        name: '복구 후보',
        modifiedAt: '2026-09-19T01:02:03.000Z',
        project,
      },
    ]);
  });

  it('sorts multiple recovery candidates from newest to oldest', async () => {
    const olderProject = createNewProject('이전 복구');
    const newerProject = createNewProject('최신 복구');
    await writeRecoveryFile(userDataDirectory, olderProject);
    await writeRecoveryFile(userDataDirectory, newerProject);
    await utimes(
      join(userDataDirectory, 'recovery', `${olderProject.projectId}.recovery.json`),
      new Date('2026-09-19T01:00:00.000Z'),
      new Date('2026-09-19T01:00:00.000Z'),
    );
    await utimes(
      join(userDataDirectory, 'recovery', `${newerProject.projectId}.recovery.json`),
      new Date('2026-09-19T02:00:00.000Z'),
      new Date('2026-09-19T02:00:00.000Z'),
    );

    const candidates = await listRecoveryFiles(userDataDirectory);

    expect(candidates.map(({ projectId }) => projectId)).toEqual([
      newerProject.projectId,
      olderProject.projectId,
    ]);
  });

  it('skips malformed and schema-invalid files while preserving valid candidates', async () => {
    const validProject = createNewProject('정상 복구');
    const invalidProject = { ...createNewProject(), schemaVersion: 4 };
    await writeRecoveryFile(userDataDirectory, validProject);
    const recoveryDirectory = join(userDataDirectory, 'recovery');
    await writeFile(
      join(recoveryDirectory, 'malformed.recovery.json'),
      '{ invalid json',
      'utf8',
    );
    await writeFile(
      join(recoveryDirectory, 'invalid-schema.recovery.json'),
      JSON.stringify(invalidProject),
      'utf8',
    );

    const candidates = await listRecoveryFiles(userDataDirectory);

    expect(candidates.map(({ projectId }) => projectId)).toEqual([
      validProject.projectId,
    ]);
  });

  it('skips unsafe filenames and filename/projectId mismatches', async () => {
    const validProject = createNewProject('정상 복구');
    const mismatchedProject = createNewProject('불일치 복구');
    await writeRecoveryFile(userDataDirectory, validProject);
    const recoveryDirectory = join(userDataDirectory, 'recovery');
    await writeFile(
      join(recoveryDirectory, 'unsafe!.recovery.json'),
      JSON.stringify(createNewProject()),
      'utf8',
    );
    await writeFile(
      join(recoveryDirectory, 'different-id.recovery.json'),
      JSON.stringify(mismatchedProject),
      'utf8',
    );

    const candidates = await listRecoveryFiles(userDataDirectory);

    expect(candidates.map(({ projectId }) => projectId)).toEqual([
      validProject.projectId,
    ]);
  });

  it('skips a candidate that cannot be read while preserving valid candidates', async () => {
    const validProject = createNewProject('정상 복구');
    await writeRecoveryFile(userDataDirectory, validProject);
    await mkdir(
      join(userDataDirectory, 'recovery', 'unreadable.recovery.json'),
    );

    const candidates = await listRecoveryFiles(userDataDirectory);

    expect(candidates.map(({ projectId }) => projectId)).toEqual([
      validProject.projectId,
    ]);
  });

  it('rejects when the recovery directory itself cannot be listed', async () => {
    await writeFile(join(userDataDirectory, 'recovery'), 'not a directory', 'utf8');

    await expect(listRecoveryFiles(userDataDirectory)).rejects.toThrow();
  });

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
