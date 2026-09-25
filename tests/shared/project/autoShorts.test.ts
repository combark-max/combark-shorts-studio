import { describe, expect, it } from 'vitest';

import {
  buildAutoShortsPlan,
  splitSubtitleUnits,
} from '../../../src/shared/project/autoShorts';
import { createNewProject } from '../../../src/shared/project/createProject';
import type { ProjectDocument } from '../../../src/shared/project/types';

function createProject(
  kinds: Array<'image' | 'video'>,
  narration = false,
): ProjectDocument {
  const project = createNewProject('자동 만들기 테스트');
  project.media = kinds.map((kind, index) => ({
    id: `${kind}-${index}`,
    kind,
    sourcePath: `C:\\media\\${kind}-${index}.${kind === 'image' ? 'jpg' : 'mp4'}`,
    fileName: `${kind}-${index}.${kind === 'image' ? 'jpg' : 'mp4'}`,
  }));
  project.scenes = project.media.map((asset, index) => ({
    mediaId: asset.id,
    durationMs: asset.kind === 'image' ? 3000 : null,
    subtitle: `기존 ${index + 1}`,
    subtitlePosition: index % 2 === 0 ? 'top' : 'bottom',
    subtitleSize: index % 2 === 0 ? 'large' : 'small',
  }));
  project.narration = narration
    ? { sourcePath: 'C:\\audio\\voice.wav', fileName: 'voice.wav' }
    : null;
  return project;
}

describe('splitSubtitleUnits', () => {
  it('uses trimmed non-empty lines as subtitle units', () => {
    expect(splitSubtitleUnits('  첫 줄  \n\n 둘째 줄\n셋째 줄  ')).toEqual([
      '첫 줄',
      '둘째 줄',
      '셋째 줄',
    ]);
  });

  it('splits a single line after sentence punctuation and preserves punctuation', () => {
    expect(splitSubtitleUnits('첫째입니다. 둘째입니다! 정말인가요? 끝')).toEqual([
      '첫째입니다.',
      '둘째입니다!',
      '정말인가요?',
      '끝',
    ]);
  });
});

describe('buildAutoShortsPlan', () => {
  it('places one subtitle unit on each scene while preserving subtitle style', () => {
    const project = createProject(['image', 'video']);

    const plan = buildAutoShortsPlan(project, '새 자막 1\n새 자막 2', {
      narrationDurationMs: null,
      videoDurationMsByMediaId: {},
    });

    expect(plan.scenes.map(({ subtitle }) => subtitle)).toEqual([
      '새 자막 1',
      '새 자막 2',
    ]);
    expect(plan.scenes.map(({ subtitlePosition, subtitleSize }) => ({
      subtitlePosition,
      subtitleSize,
    }))).toEqual(project.scenes.map(({ subtitlePosition, subtitleSize }) => ({
      subtitlePosition,
      subtitleSize,
    })));
    expect(plan.subtitleUnitCount).toBe(2);
  });

  it('groups extra adjacent units evenly without losing text', () => {
    const project = createProject(['image', 'image']);
    const plan = buildAutoShortsPlan(project, '하나\n둘\n셋\n넷\n다섯', {
      narrationDurationMs: null,
      videoDurationMsByMediaId: {},
    });

    expect(plan.scenes.map(({ subtitle }) => subtitle)).toEqual([
      '하나\n둘\n셋',
      '넷\n다섯',
    ]);
    expect(plan.scenes.map(({ subtitle }) => subtitle).join('\n')).toBe(
      '하나\n둘\n셋\n넷\n다섯',
    );
  });

  it('leaves trailing scene subtitles empty when there are fewer units', () => {
    const project = createProject(['image', 'image', 'video']);
    const plan = buildAutoShortsPlan(project, '첫 장면\n둘째 장면', {
      narrationDurationMs: null,
      videoDurationMsByMediaId: {},
    });

    expect(plan.scenes.map(({ subtitle }) => subtitle)).toEqual([
      '첫 장면',
      '둘째 장면',
      '',
    ]);
  });

  it('uses 3000ms for images without narration and keeps videos null', () => {
    const project = createProject(['image', 'video', 'image']);
    project.scenes[0].durationMs = 4500;
    project.scenes[2].durationMs = 1200;

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs: null,
      videoDurationMsByMediaId: {},
    });

    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([
      3000,
      null,
      3000,
    ]);
    expect(plan.durationMode).toBe('default');
    expect(plan.changedImageDurationCount).toBe(2);
  });

  it('distributes image-only narration duration exactly with a deterministic remainder', () => {
    const project = createProject(['image', 'image', 'image'], true);

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs: 10001,
      videoDurationMsByMediaId: {},
    });

    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([
      3334,
      3334,
      3333,
    ]);
    expect(plan.durationMode).toBe('narration');
    expect(plan.remainingMs).toBe(10001);
  });

  it('subtracts every video scene duration including repeated assets', () => {
    const project = createProject(['image', 'video', 'image'], true);
    project.scenes.splice(2, 0, { ...project.scenes[1] });

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs: 14001,
      videoDurationMsByMediaId: { 'video-1': 5000 },
    });

    expect(plan.totalVideoSceneDurationMs).toBe(10000);
    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([
      2001,
      null,
      null,
      2000,
    ]);
  });

  it.each([
    ['narration metadata is unavailable', null, { 'video-1': 1000 }],
    ['video metadata is unavailable', 9000, { 'video-1': null }],
    ['narration is not longer than videos', 5000, { 'video-1': 5000 }],
  ] as const)('falls back to 3000ms when %s', (_label, narrationDurationMs, videoDurationMsByMediaId) => {
    const project = createProject(['image', 'video'], true);
    project.scenes[0].durationMs = 4500;

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs,
      videoDurationMsByMediaId,
    });

    expect(plan.durationMode).toBe('fallback');
    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([
      3000,
      null,
    ]);
  });

  it('distributes a very small positive remainder without an arbitrary threshold', () => {
    const project = createProject(['image', 'image', 'image'], true);

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs: 4,
      videoDurationMsByMediaId: {},
    });

    expect(plan.durationMode).toBe('narration');
    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([2, 1, 1]);
  });

  it('falls back when the remainder cannot give every image a positive integer duration', () => {
    const project = createProject(['image', 'image', 'image'], true);

    const plan = buildAutoShortsPlan(project, '', {
      narrationDurationMs: 2,
      videoDurationMsByMediaId: {},
    });

    expect(plan.durationMode).toBe('fallback');
    expect(plan.scenes.map(({ durationMs }) => durationMs)).toEqual([
      3000,
      3000,
      3000,
    ]);
  });

  it('does not change scene ordering, media IDs, or the media array', () => {
    const project = createProject(['video', 'image'], false);
    const plan = buildAutoShortsPlan(project, '첫째\n둘째', {
      narrationDurationMs: null,
      videoDurationMsByMediaId: { 'video-0': 2000 },
    });

    expect(plan.scenes.map(({ mediaId }) => mediaId)).toEqual(
      project.scenes.map(({ mediaId }) => mediaId),
    );
    expect(project.media).toEqual([
      expect.objectContaining({ id: 'video-0' }),
      expect.objectContaining({ id: 'image-1' }),
    ]);
  });
});
