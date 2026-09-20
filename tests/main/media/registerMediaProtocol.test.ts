import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    handlers.clear();
    fetchFile.mockReset();
    registerSchemesAsPrivileged.mockReset();
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

  it('serves a supported absolute Windows media path through net.fetch', async () => {
    const response = new Response('media');
    fetchFile.mockResolvedValue(response);
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl('C:\\media folder\\clip.mp4')),
    );

    expect(result).toBe(response);
    expect(fetchFile).toHaveBeenCalledWith(
      'file:///C:/media%20folder/clip.mp4',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it.each(['mp3', 'wav'])('serves a supported %s narration path', async (extension) => {
    const response = new Response('narration');
    fetchFile.mockResolvedValue(response);
    registerMediaProtocol();
    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);

    const result = await handler?.(
      new Request(createMediaUrl(`C:\\audio\\voice.${extension}`)),
    );

    expect(result).toBe(response);
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
