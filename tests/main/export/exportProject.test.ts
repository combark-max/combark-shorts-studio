import { describe, expect, it, vi } from 'vitest';

import { createNewProject } from '../../../src/shared/project/createProject';
import type { ProjectDocument } from '../../../src/shared/project/types';
import {
  buildAssDocument,
  buildFinalMuxArgs,
  buildSceneArgs,
  escapeAssText,
  exportProject,
  loadDevelopmentFfmpegPath,
  resolveFfmpegPath,
} from '../../../src/main/export/exportProject';

function createExportProject(): ProjectDocument {
  return {
    ...createNewProject('내보내기 테스트'),
    media: [
      {
        id: 'image-id',
        kind: 'image',
        sourcePath: 'C:\\한글 자료\\first image.png',
        fileName: 'first image.png',
      },
      {
        id: 'video-id',
        kind: 'video',
        sourcePath: 'C:\\한글 자료\\second video.mp4',
        fileName: 'second video.mp4',
      },
    ],
    scenes: [
      { mediaId: 'image-id', durationMs: 2500, subtitle: '첫째\\줄\n{둘째}, 줄' },
      { mediaId: 'video-id', durationMs: null, subtitle: '영상 자막' },
    ],
    narration: null,
  };
}

describe('MP4 export argument generation', () => {
  it('loads the development binary from the installed ffmpeg-static package', async () => {
    const path = loadDevelopmentFfmpegPath();
    expect(path).toMatch(/[\\/]node_modules[\\/]ffmpeg-static[\\/]ffmpeg\.exe$/);
    await expect(import('node:fs/promises').then(({ access }) => access(path))).resolves.toBeUndefined();
  });

  it('selects the installed binary in development and the extra resource when packaged', () => {
    expect(resolveFfmpegPath(false, 'C:\\resources', 'C:\\node_modules\\ffmpeg.exe'))
      .toBe('C:\\node_modules\\ffmpeg.exe');
    expect(resolveFfmpegPath(true, 'C:\\Program Files\\Combark\\resources', 'ignored'))
      .toBe('C:\\Program Files\\Combark\\resources\\ffmpeg.exe');
  });

  it('escapes ASS control characters while preserving UTF-8 Korean text and line breaks', () => {
    expect(escapeAssText('한글\\N {태그}\r\n둘째\n셋째')).toBe(
      '한글\\\\N \\{태그\\}\\N둘째\\N셋째',
    );
    expect(buildAssDocument('안녕, 세상')).toContain(
      'Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,안녕, 세상',
    );
  });

  it('loops images for their exact duration and lets videos render to EOF', () => {
    const filter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,ass=filename='C\\:/Temp/sub title.ass'";
    const imageArgs = buildSceneArgs({
      kind: 'image',
      sourcePath: 'C:\\한글 자료\\first image.png',
      durationMs: 2500,
      filter,
      outputPath: 'C:\\Temp\\scene 1.mp4',
    });
    const videoArgs = buildSceneArgs({
      kind: 'video',
      sourcePath: 'C:\\한글 자료\\second video.mp4',
      durationMs: null,
      filter,
      outputPath: 'C:\\Temp\\scene 2.mp4',
    });

    expect(imageArgs).toEqual(expect.arrayContaining(['-loop', '1', '-t', '2.5']));
    expect(imageArgs).toEqual(expect.arrayContaining(['-vf', filter, '-an', '-r', '30']));
    expect(videoArgs).not.toContain('-t');
    expect(videoArgs).not.toContain('-shortest');
    expect(videoArgs).toEqual(expect.arrayContaining(['-i', 'C:\\한글 자료\\second video.mp4']));
  });

  it('creates either narration-only or silent 48 kHz stereo AAC', () => {
    const narrated = buildFinalMuxArgs(
      'C:\\Temp\\video.mp4',
      'C:\\audio\\목소리.wav',
      'C:\\Temp\\final.mp4',
    );
    const silent = buildFinalMuxArgs(
      'C:\\Temp\\video.mp4',
      null,
      'C:\\Temp\\final.mp4',
    );

    expect(narrated).toEqual(expect.arrayContaining([
      '-i', 'C:\\audio\\목소리.wav', '-af', 'apad', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart',
    ]));
    expect(narrated).not.toContain('0:a');
    expect(silent).toEqual(expect.arrayContaining([
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-c:a', 'aac', '-shortest',
    ]));
  });
});

describe('exportProject pipeline', () => {
  it('reports each export stage in execution order', async () => {
    const progress: unknown[] = [];

    await exportProject(createExportProject(), 'C:\\exports\\out.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-progress'),
      pathExists: vi.fn().mockResolvedValue(true),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      runFfmpeg: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
      onProgress: (value: unknown) => progress.push(value),
    });

    expect(progress).toEqual([
      { stage: 'preparing' },
      { stage: 'scene', sceneIndex: 1, sceneCount: 2 },
      { stage: 'scene', sceneIndex: 2, sceneCount: 2 },
      { stage: 'concatenating' },
      { stage: 'muxing-audio' },
      { stage: 'writing-output' },
      { stage: 'complete' },
    ]);
  });

  it('passes the project narration to the final mux instead of silent audio', async () => {
    const project = {
      ...createExportProject(),
      narration: {
        sourcePath: 'C:\\audio\\narration.mp3',
        fileName: 'narration.mp3',
      },
    };
    const calls: string[][] = [];

    await exportProject(project, 'C:\\exports\\out.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-narrated'),
      pathExists: vi.fn().mockResolvedValue(true),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      runFfmpeg: vi.fn(async (_path: string, args: string[]) => {
        calls.push(args);
      }),
      copyFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockResolvedValue(undefined),
    });

    const muxArgs = calls.at(-1) as string[];
    expect(muxArgs).toEqual([
      '-y',
      '-i', 'C:\\Temp\\combark-narrated\\combined.mp4',
      '-i', 'C:\\audio\\narration.mp3',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      '-af', 'apad',
      '-shortest',
      '-movflags', '+faststart',
      'C:\\Temp\\combark-narrated\\final.mp4',
    ]);
    expect(muxArgs).not.toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
  });

  it('renders scenes in document order, writes the final file, and cleans the temp directory', async () => {
    const project = createExportProject();
    const calls: string[][] = [];
    const writes: Array<[string, string]> = [];
    const remove = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);

    await exportProject(project, 'C:\\exports\\완성 영상.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark 한글'),
      pathExists: vi.fn().mockResolvedValue(true),
      writeTextFile: vi.fn(async (path: string, content: string) => {
        writes.push([path, content]);
      }),
      runFfmpeg: vi.fn(async (_path: string, args: string[]) => {
        calls.push(args);
      }),
      copyFile: copy,
      removeDirectory: remove,
    });

    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain(project.media[0].sourcePath);
    expect(calls[1]).toContain(project.media[1].sourcePath);
    expect(calls[2]).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0']));
    expect(calls[3]).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(writes.some(([, value]) => value.includes("file 'scene-000000.mp4'\nfile 'scene-000001.mp4'"))).toBe(true);
    expect(copy).toHaveBeenCalledWith(
      'C:\\Temp\\combark 한글\\final.mp4',
      'C:\\exports\\완성 영상.mp4',
    );
    expect(remove).toHaveBeenCalledWith('C:\\Temp\\combark 한글');
  });

  it('rejects empty scenes, missing sources, missing Korean font, and source/output collisions', async () => {
    const project = createExportProject();
    const baseDependencies = {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn(),
      writeTextFile: vi.fn(),
      runFfmpeg: vi.fn(),
      copyFile: vi.fn(),
      removeDirectory: vi.fn(),
    };

    await expect(exportProject({ ...project, scenes: [] }, 'C:\\exports\\out.mp4', {
      ...baseDependencies,
      pathExists: vi.fn().mockResolvedValue(true),
    })).rejects.toThrow('장면');
    await expect(exportProject(project, 'C:\\exports\\out.mp4', {
      ...baseDependencies,
      pathExists: vi.fn(async (path: string) => path !== project.media[1].sourcePath),
    })).rejects.toThrow('second video.mp4');
    await expect(exportProject(project, 'C:\\exports\\out.mp4', {
      ...baseDependencies,
      pathExists: vi.fn(async (path: string) => path !== baseDependencies.fontPath),
    })).rejects.toThrow('맑은 고딕');
    await expect(exportProject(project, 'c:\\한글 자료\\FIRST IMAGE.PNG', {
      ...baseDependencies,
      pathExists: vi.fn().mockResolvedValue(true),
    })).rejects.toThrow('원본');
  });

  it('cleans its temporary directory when ffmpeg rejects a damaged source', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await expect(exportProject(createExportProject(), 'C:\\exports\\out.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-failure'),
      pathExists: vi.fn().mockResolvedValue(true),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      runFfmpeg: vi.fn().mockRejectedValue(new Error('Invalid data found when processing input')),
      copyFile: vi.fn(),
      removeDirectory: remove,
    })).rejects.toThrow('Invalid data');

    expect(remove).toHaveBeenCalledWith('C:\\Temp\\combark-failure');
  });

  it('does not report complete when temporary-directory cleanup fails', async () => {
    const progress: unknown[] = [];

    await expect(exportProject(createExportProject(), 'C:\\exports\\out.mp4', {
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      fontPath: 'C:\\Windows\\Fonts\\malgun.ttf',
      makeTempDirectory: vi.fn().mockResolvedValue('C:\\Temp\\combark-cleanup-failure'),
      pathExists: vi.fn().mockResolvedValue(true),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      runFfmpeg: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      removeDirectory: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      onProgress: (value: unknown) => progress.push(value),
    })).rejects.toThrow('cleanup failed');

    expect(progress.at(-1)).toEqual({ stage: 'writing-output' });
    expect(progress).not.toContainEqual({ stage: 'complete' });
  });
});
