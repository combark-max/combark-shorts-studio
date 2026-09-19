import { describe, expect, it } from 'vitest';
import {
  ensureProjectExtension,
  isProjectFilePath,
} from '../../../src/shared/project/path';

describe('ensureProjectExtension', () => {
  it('adds the project extension when missing', () => {
    expect(ensureProjectExtension('video')).toBe('video.cssproj');
  });

  it('preserves an existing extension case-insensitively', () => {
    expect(ensureProjectExtension('video.cssproj')).toBe('video.cssproj');
    expect(ensureProjectExtension('video.CSSPROJ')).toBe('video.CSSPROJ');
  });

  it('adds the extension to a path and existing different extension', () => {
    expect(ensureProjectExtension('C:\\projects\\video')).toBe(
      'C:\\projects\\video.cssproj',
    );
    expect(ensureProjectExtension('video.json')).toBe('video.json.cssproj');
  });
});

describe('isProjectFilePath', () => {
  it.each(['project.cssproj', 'project.CSSPROJ'])('accepts %s', (filePath) => {
    expect(isProjectFilePath(filePath)).toBe(true);
  });

  it.each(['project.json', 'project', 'project.cssproj.bak'])('rejects %s', (filePath) => {
    expect(isProjectFilePath(filePath)).toBe(false);
  });
});