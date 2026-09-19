import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNewProject } from '../../../src/shared/project/createProject';
import {
  readProjectFile,
  writeProjectFileAtomic,
} from '../../../src/main/project/projectStorage';

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'combark-project-storage-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('projectStorage', () => {
  it('writes and reads a project atomically with formatted JSON', async () => {
    const project = createNewProject('저장 테스트');
    const filePath = join(temporaryDirectory, 'project.cssproj');

    await writeProjectFileAtomic(filePath, project);

    const contents = await readFile(filePath, 'utf8');
    expect(JSON.parse(contents)).toEqual(project);
    expect(contents).toBe(`${JSON.stringify(project, null, 2)}\n`);
    expect(contents.endsWith('\n')).toBe(true);
    expect(await readProjectFile(filePath)).toEqual(project);
  });

  it('can replace an existing project file without leaving a temp file', async () => {
    const filePath = join(temporaryDirectory, 'project.cssproj');
    const firstProject = createNewProject('첫 저장');
    const secondProject = createNewProject('두 번째 저장');

    await writeProjectFileAtomic(filePath, firstProject);
    await writeProjectFileAtomic(filePath, secondProject);

    expect(await readProjectFile(filePath)).toEqual(secondProject);
    expect((await readdir(temporaryDirectory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('rejects invalid JSON', async () => {
    const filePath = join(temporaryDirectory, 'invalid.cssproj');
    await writeFile(filePath, '{ invalid json', 'utf8');

    await expect(readProjectFile(filePath)).rejects.toThrow();
  });

  it('rejects a project with an invalid schema', async () => {
    const filePath = join(temporaryDirectory, 'invalid-schema.cssproj');
    const project = createNewProject();
    await writeFile(
      filePath,
      JSON.stringify({ ...project, schemaVersion: 2 }),
      'utf8',
    );

    await expect(readProjectFile(filePath)).rejects.toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it('passes through a missing file error', async () => {
    const filePath = join(temporaryDirectory, 'missing.cssproj');

    await expect(readProjectFile(filePath)).rejects.toThrow();
  });
});