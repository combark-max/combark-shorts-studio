import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { VideoFinalCorrectionRequest } from '../../../src/shared/videoFinalCorrection';
import {
  assertAtomicPublicationSupported,
  buildFinalCorrectionTransformArgs,
  correctFinalVideo,
  parseFinalCorrectionMediaMetadata,
  publishFinalCorrectionFile,
  type FinalCorrectionMediaMetadata,
} from '../../../src/main/video-final-correction/correctFinalVideo';

const sourceMetadata: FinalCorrectionMediaMetadata = {
  width: 1_080,
  height: 1_920,
  fps: 30,
  frameCount: 360,
  durationMs: 12_000,
  sampleAspectRatio: '1:1',
  displayAspectRatio: '9:16',
  audioStreamCount: 1,
  audioStreams: [{ codec: 'aac', sampleRate: 48_000, channelLayout: 'stereo', language: null, default: false }],
};

const request: VideoFinalCorrectionRequest = {
  sourcePath: 'C:\\media\\source.mp4',
  outputPath: 'C:\\media\\source-corrected.mp4',
  method: 'basic',
};

describe('whole-file correction command', () => {
  it('stabilizes every frame while stream-copying every audio stream', () => {
    const args = buildFinalCorrectionTransformArgs({
      request,
      metadata: sourceMetadata,
      transformPath: 'C:\\temp\\motions.trf',
      pendingPath: 'C:\\media\\.pending.mp4',
    });
    expect(args.slice(0, 5)).toEqual(['-n', '-hide_banner', '-nostdin', '-i', request.sourcePath]);
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain('vidstabtransform=');
    expect(filter).toContain('smoothing=8');
    expect(filter).toContain('optzoom=0');
    expect(filter).toContain('zoom=2');
    expect(filter).toContain('setsar=1/1');
    expect(args).toEqual(expect.arrayContaining([
      '-map', '0:v:0', '-map', '0:a?', '-frames:v', '360',
      '-c:v', 'libx264', '-c:a', 'copy', '-map_metadata', '0', '-map_chapters', '0',
      '-progress', 'pipe:1', 'C:\\media\\.pending.mp4',
    ]));
    expect(args.join(' ')).not.toMatch(/(?:^|\s)(?:-r|fps=|scale=)/);
  });

  it('parses exact frame progress, aspect ratio, and all audio streams', () => {
    const stderr = [
      'Input #0, mov,mp4, from source.mp4:',
      '  Duration: 00:00:12.00, start: 0.000000, bitrate: 1000 kb/s',
      '  Stream #0:0: Video: h264, yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], 30 fps',
      '  Stream #0:1: Audio: aac, 48000 Hz, stereo',
      '  Stream #0:2: Audio: aac, 48000 Hz, stereo',
      'Stream mapping:',
      '  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))',
      'Output #0, null, to pipe:',
      '  Stream #0:1: Audio: pcm_s16le, 48000 Hz, stereo',
      '[Parsed_vfrdet_0] VFR:0.000000 (0/359)',
    ].join('\n');
    expect(parseFinalCorrectionMediaMetadata(stderr, 'frame=360\nprogress=end\n')).toEqual({
      ...sourceMetadata,
      audioStreamCount: 2,
      audioStreams: [
        { codec: 'aac', sampleRate: 48_000, channelLayout: 'stereo', language: null, default: false },
        { codec: 'aac', sampleRate: 48_000, channelLayout: 'stereo', language: null, default: false },
      ],
    });
  });

  it('publishes with an atomic no-replace operation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'combark-final-publish-test-'));
    const pending = join(directory, 'pending.mp4');
    const output = join(directory, 'output.mp4');
    try {
      await writeFile(pending, 'verified-result');
      await writeFile(output, 'unrelated-existing-file');
      await expect(publishFinalCorrectionFile(pending, output)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(output, 'utf8')).toBe('unrelated-existing-file');
      expect(await readFile(pending, 'utf8')).toBe('verified-result');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects publication when the destination filesystem has no hard links', async () => {
    const unsupported = Object.assign(new Error('hard links unsupported'), { code: 'ENOTSUP' });
    await expect(publishFinalCorrectionFile('pending.mp4', 'output.mp4', {
      linkFile: vi.fn(async () => { throw unsupported; }),
    })).rejects.toBe(unsupported);
  });

  it('does not delete a probe-link path it failed to create', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'combark-final-probe-test-'));
    const removeFile = vi.fn(async (path: string) => void path);
    try {
      await expect(assertAtomicPublicationSupported(join(directory, 'output.mp4'), {
        linkFile: vi.fn(async () => {
          throw Object.assign(new Error('probe link collision'), { code: 'EEXIST' });
        }),
        removeFile,
      })).rejects.toThrow('안전한 게시');
      expect(removeFile).toHaveBeenCalledTimes(1);
      expect(removeFile.mock.calls[0][0]).not.toContain('.link.tmp');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('whole-file correction lifecycle', () => {
  it.each([
    ['C:\\MEDIA\\source.mp4', false, '원본'],
    ['C:\\media\\source-corrected.mp4', true, '이미'],
  ])('rejects unsafe output %s before FFmpeg starts', async (outputPath, outputExists, message) => {
    const runProcess = vi.fn();
    await expect(correctFinalVideo({ ...request, outputPath }, dependencies({
      pathExists: async (path: string) => path === outputPath ? outputExists : true,
      runProcess,
    }))).rejects.toThrow(message);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('rejects unsupported destination filesystems before decoding starts', async () => {
    const runProcess = vi.fn();
    await expect(correctFinalVideo(request, dependencies({
      assertPublishSupported: vi.fn(async () => { throw new Error('safe publication unsupported'); }),
      runProcess,
    }))).rejects.toThrow('unsupported');
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('publishes only after transform count and complete output metadata verify', async () => {
    const onProgress = vi.fn();
    const publishFile = vi.fn(async () => undefined);
    const calls: string[][] = [];
    const result = await correctFinalVideo(request, dependencies({
      onProgress,
      publishFile,
      runProcess: vi.fn(async (_path: string, args: string[], callbacks: { onProgressFrame?: (frame: number) => void }) => {
        calls.push(args);
        callbacks.onProgressFrame?.(180);
        return { code: 0, stdout: 'frame=360\nprogress=end\n', stderr: '' };
      }),
    }));
    expect(calls).toHaveLength(2);
    expect(calls[0].join(' ')).toContain('vidstabdetect=');
    expect(calls[1].join(' ')).toContain('vidstabtransform=');
    expect(publishFile).toHaveBeenCalledWith('C:\\media\\.pending.mp4', request.outputPath);
    expect(result).toMatchObject({
      sourcePath: request.sourcePath,
      outputPath: request.outputPath,
      method: 'basic',
      frameCount: 360,
      audioStreamCount: 1,
    });
    expect(onProgress.mock.calls.map(([value]) => value.percent)).toEqual(
      expect.arrayContaining([0, 30, 70, 90, 99, 100]),
    );
  });

  it('reports progress while decoding the source before motion analysis', async () => {
    const onProgress = vi.fn();
    await correctFinalVideo(request, dependencies({
      sourceFrameEstimate: 360,
      onProgress,
      inspectMedia: vi.fn()
        .mockImplementationOnce(async (_path, _signal, onFrame) => {
          onFrame?.(180);
          return sourceMetadata;
        })
        .mockResolvedValueOnce(sourceMetadata),
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'checking', percent: 5, processedFrames: 180, totalFrames: 360,
    }));
  });

  it('rejects output whose audio stream signature differs from the source', async () => {
    await expect(correctFinalVideo(request, dependencies({
      inspectMedia: vi.fn()
        .mockResolvedValueOnce(sourceMetadata)
        .mockResolvedValueOnce({
          ...sourceMetadata,
          audioStreams: [{ ...sourceMetadata.audioStreams[0], sampleRate: 44_100 }],
        }),
    }))).rejects.toThrow('오디오');
  });

  it('removes pending output and transform directory after verification failure', async () => {
    const removeFile = vi.fn(async () => undefined);
    const removeDirectory = vi.fn(async () => undefined);
    const publishFile = vi.fn(async () => undefined);
    await expect(correctFinalVideo(request, dependencies({
      inspectMedia: vi.fn()
        .mockResolvedValueOnce(sourceMetadata)
        .mockResolvedValueOnce({ ...sourceMetadata, frameCount: 359 }),
      removeFile,
      removeDirectory,
      publishFile,
    }))).rejects.toThrow('프레임 수');
    expect(publishFile).not.toHaveBeenCalled();
    expect(removeFile).toHaveBeenCalledWith('C:\\media\\.pending.mp4');
    expect(removeDirectory).toHaveBeenCalledWith('C:\\temp\\job');
  });

  it('does not publish when the source changes during correction', async () => {
    const publishFile = vi.fn(async () => undefined);
    const beforePublish = vi.fn(async () => { throw new Error('원본 영상이 보정 중 변경되었습니다.'); });
    await expect(correctFinalVideo(request, dependencies({
      beforePublish,
      publishFile,
    }))).rejects.toThrow('변경');
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(publishFile).not.toHaveBeenCalled();
  });

  it('keeps a successfully published result when pending-name cleanup fails', async () => {
    const removeFile = vi.fn(async () => { throw new Error('temporary unlink failed'); });
    await expect(correctFinalVideo(request, dependencies({
      publishFile: vi.fn(async () => undefined),
      removeFile,
    }))).resolves.toMatchObject({ outputPath: request.outputPath });
    expect(removeFile).toHaveBeenCalledWith('C:\\media\\.pending.mp4');
  });
});

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    ffmpegPath: 'C:\\ffmpeg.exe',
    pathExists: async () => false,
    assertPublishSupported: vi.fn(async () => undefined),
    makeTempDirectory: async () => 'C:\\temp\\job',
    makePendingPath: () => 'C:\\media\\.pending.mp4',
    inspectMedia: vi.fn()
      .mockResolvedValueOnce(sourceMetadata)
      .mockResolvedValueOnce(sourceMetadata),
    runProcess: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    readTextFile: async () => Array.from({ length: 360 }, (_, index) =>
      `Frame ${index} (List 0 [])`).join('\n'),
    publishFile: vi.fn(async () => undefined),
    removeFile: vi.fn(async () => undefined),
    removeDirectory: vi.fn(async () => undefined),
    ...overrides,
  };
}
