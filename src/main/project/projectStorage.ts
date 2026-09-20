import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { validateProjectDocument } from '../../shared/project/validateProject';
import type { ProjectDocument } from '../../shared/project/types';

export async function readProjectFile(
  filePath: string,
): Promise<ProjectDocument> {
  const contents = await readFile(filePath, 'utf8');
  const value: unknown = JSON.parse(contents);

  return validateProjectDocument(value);
}

export async function writeProjectFileAtomic(
  filePath: string,
  project: ProjectDocument,
): Promise<void> {
  const validatedProject = validateProjectDocument(project);
  const contents = `${JSON.stringify(validatedProject, null, 2)}\n`;
  const temporaryFilePath = join(
    dirname(filePath),
    `${basename(filePath)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  let fileHandle: FileHandle | undefined;

  try {
    fileHandle = await open(temporaryFilePath, 'w');
    await fileHandle.writeFile(contents, 'utf8');
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(temporaryFilePath, filePath);
  } catch (error) {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Preserve the original storage error.
      }
    }

    try {
      await rm(temporaryFilePath, { force: true });
    } catch {
      // Preserve the original storage error.
    }

    throw error;
  }
}
