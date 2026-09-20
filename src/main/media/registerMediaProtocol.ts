import { pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

import { MEDIA_PROTOCOL_SCHEME } from '../../shared/mediaProtocol';
import { getMediaKind } from '../../shared/project/media';

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL_SCHEME,
      privileges: {
        secure: true,
        standard: true,
        stream: true,
      },
    },
  ]);
}

export function registerMediaProtocol(): void {
  void protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    let url: URL;

    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }

    const sourcePath = url.searchParams.get('path');
    if (
      request.method !== 'GET' ||
      url.host !== 'local' ||
      !sourcePath ||
      !isAbsoluteWindowsPath(sourcePath) ||
      !getMediaKind(sourcePath)
    ) {
      return new Response(null, { status: 400 });
    }

    try {
      return await net.fetch(pathToFileURL(sourcePath).toString(), {
        headers: request.headers,
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
