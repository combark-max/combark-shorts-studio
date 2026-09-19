import { describe, expect, it } from 'vitest';
import { validateProjectDocument } from '../../../src/shared/project/validateProject';

const validProject = {
  schemaVersion: 1,
  projectId: '12345678-1234-4123-8123-123456789abc',
  name: '새 프로젝트',
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
  settings: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
};

describe('validateProjectDocument', () => {
  it('accepts a valid v1 project document', () => {
    expect(validateProjectDocument(validProject)).toEqual(validProject);
  });

  it.each([null, [], 'project', 1, true])('rejects non-object input: %p', (value) => {
    expect(() => validateProjectDocument(value)).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['projectId missing', { projectId: undefined }],
    ['projectId empty', { projectId: '' }],
    ['name missing', { name: undefined }],
    ['name empty', { name: '' }],
    ['createdAt missing', { createdAt: undefined }],
    ['createdAt empty', { createdAt: '' }],
    ['updatedAt missing', { updatedAt: undefined }],
    ['updatedAt empty', { updatedAt: '' }],
    ['settings missing', { settings: undefined }],
  ])('rejects invalid %s', (_label, change) => {
    expect(() => validateProjectDocument({ ...validProject, ...change })).toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it.each([
    ['width', { width: 720 }],
    ['height', { height: 1080 }],
    ['fps', { fps: 60 }],
  ])('rejects invalid settings %s', (_label, change) => {
    expect(() =>
      validateProjectDocument({
        ...validProject,
        settings: { ...validProject.settings, ...change },
      }),
    ).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });

  it('rejects unknown top-level fields', () => {
    expect(() => validateProjectDocument({ ...validProject, media: [] })).toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it('rejects unknown settings fields', () => {
    expect(() =>
      validateProjectDocument({
        ...validProject,
        settings: { ...validProject.settings, orientation: 'portrait' },
      }),
    ).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });
});