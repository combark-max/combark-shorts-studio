import { PROJECT_EXTENSION } from '../appInfo';

export function ensureProjectExtension(filePath: string): string {
  if (isProjectFilePath(filePath)) {
    return filePath;
  }

  return `${filePath}${PROJECT_EXTENSION}`;
}

export function isProjectFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(PROJECT_EXTENSION);
}