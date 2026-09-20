import { describe, expect, it } from 'vitest';
import { validateProjectDocument } from '../../../src/shared/project/validateProject';

const validProjectV1 = {
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

const validProjectV2 = {
  ...validProjectV1,
  schemaVersion: 2,
  media: [
    {
      id: 'image-id',
      kind: 'image',
      sourcePath: 'C:\\media\\photo.jpg',
      fileName: 'photo.jpg',
    },
    {
      id: 'video-id',
      kind: 'video',
      sourcePath: 'C:\\media\\clip.mp4',
      fileName: 'clip.mp4',
    },
  ],
};

describe('validateProjectDocument', () => {
  it('migrates a valid v1 project document to v2 with empty media', () => {
    expect(validateProjectDocument(validProjectV1)).toEqual({
      ...validProjectV1,
      schemaVersion: 2,
      media: [],
    });
  });

  it('accepts a valid v2 project document with media', () => {
    expect(validateProjectDocument(validProjectV2)).toEqual(validProjectV2);
  });

  it.each([null, [], 'project', 1, true])('rejects non-object input: %p', (value) => {
    expect(() => validateProjectDocument(value)).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });

  it.each([
    ['schemaVersion', { schemaVersion: 3 }],
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
    expect(() => validateProjectDocument({ ...validProjectV1, ...change })).toThrow(
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
        ...validProjectV1,
        settings: { ...validProjectV1.settings, ...change },
      }),
    ).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });

  it('rejects unknown top-level fields', () => {
    expect(() => validateProjectDocument({ ...validProjectV1, media: [] })).toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it.each([
    ['missing media', { ...validProjectV2, media: undefined }],
    ['non-array media', { ...validProjectV2, media: {} }],
    [
      'invalid kind',
      {
        ...validProjectV2,
        media: [{ ...validProjectV2.media[0], kind: 'audio' }],
      },
    ],
    [
      'unknown media field',
      {
        ...validProjectV2,
        media: [{ ...validProjectV2.media[0], duration: 1 }],
      },
    ],
    [
      'relative source path',
      {
        ...validProjectV2,
        media: [{ ...validProjectV2.media[0], sourcePath: 'photo.jpg' }],
      },
    ],
    [
      'unsupported source extension',
      {
        ...validProjectV2,
        media: [
          {
            ...validProjectV2.media[0],
            sourcePath: 'C:\\media\\photo.gif',
            fileName: 'photo.gif',
          },
        ],
      },
    ],
    [
      'kind and extension mismatch',
      {
        ...validProjectV2,
        media: [{ ...validProjectV2.media[1], kind: 'image' }],
      },
    ],
  ])('rejects v2 media with %s', (_label, project) => {
    expect(() => validateProjectDocument(project)).toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it('rejects unknown settings fields', () => {
    expect(() =>
      validateProjectDocument({
        ...validProjectV1,
        settings: { ...validProjectV1.settings, orientation: 'portrait' },
      }),
    ).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });
});
