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

const validProjectV3 = {
  ...validProjectV2,
  schemaVersion: 3,
  scenes: [
    { mediaId: 'image-id', durationMs: 3000 },
    { mediaId: 'video-id', durationMs: null },
  ],
};

const validProjectV4 = {
  ...validProjectV2,
  schemaVersion: 4,
  scenes: [
    { mediaId: 'image-id', durationMs: 3000, subtitle: '이미지 자막' },
    { mediaId: 'video-id', durationMs: null, subtitle: '' },
  ],
};

const validProjectV5 = {
  ...validProjectV4,
  schemaVersion: 5,
  narration: {
    sourcePath: 'C:\\audio\\narration.mp3',
    fileName: 'narration.mp3',
  },
};

const validProjectV6 = {
  ...validProjectV5,
  schemaVersion: 6,
  scenes: validProjectV4.scenes.map((scene) => ({
    ...scene,
    subtitlePosition: 'bottom',
    subtitleSize: 'medium',
  })),
};

const withDefaultSubtitleStyle = (scene: Record<string, unknown>) => ({
  ...scene,
  subtitlePosition: 'bottom',
  subtitleSize: 'medium',
});

describe('validateProjectDocument', () => {
  it('migrates a valid v1 project document to v6 with empty media, scenes, and narration', () => {
    expect(validateProjectDocument(validProjectV1)).toEqual({
      ...validProjectV1,
      schemaVersion: 6,
      media: [],
      scenes: [],
      narration: null,
    });
  });

  it('migrates a valid v2 project document to v6 with one scene per media asset and default subtitle styles', () => {
    expect(validateProjectDocument(validProjectV2)).toEqual({
      ...validProjectV4,
      scenes: [
        withDefaultSubtitleStyle({ mediaId: 'image-id', durationMs: 3000, subtitle: '' }),
        withDefaultSubtitleStyle({ mediaId: 'video-id', durationMs: null, subtitle: '' }),
      ],
      schemaVersion: 6,
      narration: null,
    });
  });

  it('migrates a valid v3 project document to v6 with empty subtitles and default styles', () => {
    expect(validateProjectDocument(validProjectV3)).toEqual({
      ...validProjectV3,
      schemaVersion: 6,
      scenes: [
        withDefaultSubtitleStyle({ mediaId: 'image-id', durationMs: 3000, subtitle: '' }),
        withDefaultSubtitleStyle({ mediaId: 'video-id', durationMs: null, subtitle: '' }),
      ],
      narration: null,
    });
  });

  it('migrates a valid v4 project document to v6 with default styles and without narration', () => {
    expect(validateProjectDocument(validProjectV4)).toEqual({
      ...validProjectV4,
      schemaVersion: 6,
      scenes: validProjectV4.scenes.map(withDefaultSubtitleStyle),
      narration: null,
    });
  });

  it('migrates a valid v5 project document to v6 with default subtitle styles', () => {
    expect(validateProjectDocument(validProjectV5)).toEqual({
      ...validProjectV5,
      schemaVersion: 6,
      scenes: validProjectV5.scenes.map(withDefaultSubtitleStyle),
    });
  });

  it.each(['mp3', 'wav'])('accepts a valid v6 %s narration', (extension) => {
    const project = {
      ...validProjectV6,
      narration: {
        sourcePath: `C:\\audio\\voice.${extension}`,
        fileName: `voice.${extension}`,
      },
    };

    expect(validateProjectDocument(project)).toEqual(project);
  });

  it.each(['top', 'center', 'bottom'])('accepts v6 subtitle position %s', (subtitlePosition) => {
    const project = {
      ...validProjectV6,
      scenes: [{ ...validProjectV6.scenes[0], subtitlePosition }],
    };

    expect(validateProjectDocument(project)).toEqual(project);
  });

  it.each(['small', 'medium', 'large'])('accepts v6 subtitle size %s', (subtitleSize) => {
    const project = {
      ...validProjectV6,
      scenes: [{ ...validProjectV6.scenes[0], subtitleSize }],
    };

    expect(validateProjectDocument(project)).toEqual(project);
  });

  it('accepts multiple v6 scenes that reference the same media asset', () => {
    const duplicateScene = {
      ...validProjectV6.scenes[0],
      durationMs: 4500,
      subtitle: '복제 자막',
      subtitlePosition: 'top',
      subtitleSize: 'large',
    };
    const project = {
      ...validProjectV6,
      scenes: [validProjectV6.scenes[0], duplicateScene],
    };

    expect(validateProjectDocument(project)).toEqual(project);
  });

  it.each([
    ['missing position', { subtitlePosition: undefined }],
    ['invalid position', { subtitlePosition: 'left' }],
    ['missing size', { subtitleSize: undefined }],
    ['invalid size', { subtitleSize: 'huge' }],
    ['unknown field', { style: 'bold' }],
  ])('rejects v6 scene with %s', (_label, change) => {
    const scene: Record<string, unknown> = { ...validProjectV6.scenes[0], ...change };
    if ('subtitlePosition' in change && change.subtitlePosition === undefined) {
      delete scene.subtitlePosition;
    }
    if ('subtitleSize' in change && change.subtitleSize === undefined) {
      delete scene.subtitleSize;
    }

    expect(() => validateProjectDocument({ ...validProjectV6, scenes: [scene] })).toThrow();
  });

  it.each([
    ['relative path', { sourcePath: 'voice.mp3', fileName: 'voice.mp3' }],
    ['unsupported extension', { sourcePath: 'C:\\audio\\voice.aac', fileName: 'voice.aac' }],
    ['missing file name', { sourcePath: 'C:\\audio\\voice.wav' }],
    [
      'unknown field',
      { sourcePath: 'C:\\audio\\voice.mp3', fileName: 'voice.mp3', duration: 3 },
    ],
  ])('rejects v5 narration with %s', (_label, narration) => {
    expect(() =>
      validateProjectDocument({ ...validProjectV5, narration }),
    ).toThrow();
  });

  it.each([null, [], 'project', 1, true])('rejects non-object input: %p', (value) => {
    expect(() => validateProjectDocument(value)).toThrow('유효하지 않은 프로젝트 파일입니다.');
  });

  it.each([
    ['schemaVersion', { schemaVersion: 7 }],
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
    [
      'duplicate media id',
      {
        ...validProjectV2,
        media: [validProjectV2.media[0], { ...validProjectV2.media[0] }],
      },
    ],
  ])('rejects v2 media with %s', (_label, project) => {
    expect(() => validateProjectDocument(project)).toThrow(
      '유효하지 않은 프로젝트 파일입니다.',
    );
  });

  it.each([
    ['missing scenes', { ...validProjectV3, scenes: undefined }],
    ['non-array scenes', { ...validProjectV3, scenes: {} }],
    [
      'unknown mediaId',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'missing-id', durationMs: 3000 }],
      },
    ],
    [
      'duplicate scene',
      {
        ...validProjectV3,
        scenes: [
          { mediaId: 'image-id', durationMs: 3000 },
          { mediaId: 'image-id', durationMs: 4000 },
        ],
      },
    ],
    [
      'image duration null',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'image-id', durationMs: null }],
      },
    ],
    [
      'image duration zero',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'image-id', durationMs: 0 }],
      },
    ],
    [
      'image duration fractional milliseconds',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'image-id', durationMs: 3000.5 }],
      },
    ],
    [
      'video numeric duration',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'video-id', durationMs: 5000 }],
      },
    ],
    [
      'unknown scene field',
      {
        ...validProjectV3,
        scenes: [{ mediaId: 'image-id', durationMs: 3000, id: 'scene-id' }],
      },
    ],
  ])('rejects v3 scenes with %s', (_label, project) => {
    expect(() => validateProjectDocument(project)).toThrow();
  });

  it.each([
    ['missing subtitle', { mediaId: 'image-id', durationMs: 3000 }],
    [
      'non-string subtitle',
      { mediaId: 'image-id', durationMs: 3000, subtitle: 123 },
    ],
    [
      'unknown scene field',
      {
        mediaId: 'image-id',
        durationMs: 3000,
        subtitle: '',
        style: 'bold',
      },
    ],
  ])('rejects v4 scenes with %s', (_label, scene) => {
    expect(() =>
      validateProjectDocument({ ...validProjectV4, scenes: [scene] }),
    ).toThrow();
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
