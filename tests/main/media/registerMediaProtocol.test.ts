import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchFile, handlers, registerSchemesAsPrivileged } = vi.hoisted(() => ({
  fetchFile: vi.fn(),
  handlers: new Map<string, (request: Request) => Promise<Response>>(),
  registerSchemesAsPrivileged: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: fetchFile },
  protocol: {
    handle: vi.fn(
      (
        scheme: string,
        handler: (request: Request) => Promise<Response>,
      ) => {
        handlers.set(scheme, handler);
      },
    ),
    registerSchemesAsPrivileged,
  },
}));

import {
  registerMediaProtocol,
  registerMediaProtocolScheme,
} from '../../../src/main/media/registerMediaProtocol';
import {
  createMediaUrl,
  MEDIA_PROTOCOL_SCHEME,
} from '../../../src/shared/mediaProtocol';

describe('registerMediaProtocol', () => {
  let temporaryDirectory: string;
  let fixtureBytes: Uint8Array;
  let imagePath: string;
  let audioPath: string;
  let videoPath: string;

  beforeEach(async () => {
    handlers.clear();
    fetchFile.mockReset();
    registerSchemesAsPrivileged.mockReset();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'combark-media-range-'));
    fixtureBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    imagePath = join(temporaryDirectory, 'image.png');
    audioPath = join(temporaryDirectory, 'voice.mp3');
    videoPath = join(temporaryDirectory, 'clip.mp4');
    await Promise.all([
      writeFile(imagePath, fixtureBytes),
      writeFile(audioPath, fixtureBytes),
      writeFile(videoPath, fixtureBytes),
    ]);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it('registers a secure streaming scheme without bypassing CSP', () => {
    registerMediaProtocolScheme();

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: MEDIA_PROTOCOL_SCHEME,
        privileges: {
          secure: true,
          standard: true,
          stream: true,
        },
      },
    ]);
  });

  it('serves a complete image through net.fetch with byte-range discovery', async () => {
    const response = new Response(fixtureBytes.buffer as ArrayBuffer, {
      headers: { 'Content-Type': 'image/png' },
    });
    fetchFile.mockResolvedValue(response);
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(imagePath)),
    );

    expect(result?.status).toBe(200);
    expect(result?.headers.get('Accept-Ranges')).toBe('bytes');
    expect(result?.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await result?.arrayBuffer())).toEqual(fixtureBytes);
    expect(fetchFile).toHaveBeenCalledWith(
      expect.stringMatching(/image\.png$/),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('returns exactly bytes 0-99 with partial-content headers', async () => {
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(audioPath), {
        headers: { Range: 'bytes=0-99' },
      }),
    );

    expect(result?.status).toBe(206);
    expect(result?.headers.get('Accept-Ranges')).toBe('bytes');
    expect(result?.headers.get('Content-Range')).toBe('bytes 0-99/256');
    expect(result?.headers.get('Content-Length')).toBe('100');
    expect(result?.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await result?.arrayBuffer())).toEqual(
      fixtureBytes.slice(0, 100),
    );
  });

  it('returns an open-ended range from its start through the file end', async () => {
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(videoPath), {
        headers: { Range: 'bytes=100-' },
      }),
    );

    expect(result?.status).toBe(206);
    expect(result?.headers.get('Content-Range')).toBe('bytes 100-255/256');
    expect(result?.headers.get('Content-Length')).toBe('156');
    expect(result?.headers.get('Content-Type')).toBe('video/mp4');
    expect(new Uint8Array(await result?.arrayBuffer())).toEqual(
      fixtureBytes.slice(100),
    );
  });

  it('returns a suffix range from the end of the file', async () => {
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(audioPath), {
        headers: { Range: 'bytes=-100' },
      }),
    );

    expect(result?.status).toBe(206);
    expect(result?.headers.get('Content-Range')).toBe('bytes 156-255/256');
    expect(result?.headers.get('Content-Length')).toBe('100');
    expect(new Uint8Array(await result?.arrayBuffer())).toEqual(
      fixtureBytes.slice(156),
    );
  });

  it.each([
    ['a start beyond the file', 'bytes=256-'],
    ['reversed bounds', 'bytes=100-99'],
    ['an empty suffix', 'bytes=-0'],
    ['invalid syntax', 'items=0-99'],
    ['multiple ranges', 'bytes=0-99,200-255'],
  ])('rejects %s with a range-not-satisfiable response', async (_label, range) => {
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(audioPath), {
        headers: { Range: range },
      }),
    );

    expect(result?.status).toBe(416);
    expect(result?.headers.get('Accept-Ranges')).toBe('bytes');
    expect(result?.headers.get('Content-Range')).toBe('bytes */256');
    if (!result) {
      throw new Error('Expected a protocol response.');
    }
    expect((await result.arrayBuffer()).byteLength).toBe(0);
  });

  it.each(['mp3', 'wav'])('serves a supported %s narration path', async (extension) => {
    const response = new Response('narration');
    fetchFile.mockResolvedValue(response);
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(`C:\\audio\\voice.${extension}`)),
    );

    expect(result?.status).toBe(200);
    expect(result?.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await result?.text()).toBe('narration');
    expect(fetchFile).toHaveBeenCalledOnce();
  });

  it.each([
    ['non-GET request', createMediaUrl('C:\\media\\photo.jpg'), 'POST'],
    ['unexpected host', 'combark-media://other/?path=C%3A%5Cmedia%5Cphoto.jpg', 'GET'],
    ['relative path', 'combark-media://local/?path=photo.jpg', 'GET'],
    ['unsupported extension', 'combark-media://local/?path=C%3A%5Cmedia%5Cnote.txt', 'GET'],
  ])('rejects %s', async (_label, url, method) => {
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(new Request(url, { method }));

    expect(result?.status).toBe(400);
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('returns not found when the local media cannot be read', async () => {
    fetchFile.mockRejectedValue(new Error('missing'));
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl('C:\\media\\missing.jpg')),
    );

    expect(result?.status).toBe(404);
  });
});
