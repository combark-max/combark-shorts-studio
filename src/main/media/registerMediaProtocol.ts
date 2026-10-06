import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

import { MEDIA_PROTOCOL_SCHEME } from '../../shared/mediaProtocol';
import {
  getMediaKind,
  isSupportedNarrationPath,
} from '../../shared/project/media';

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

interface ByteRange {
  start: number;
  end: number;
}

const contentTypesByExtension: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function getContentType(sourcePath: string): string {
  return contentTypesByExtension[
    extname(sourcePath).toLocaleLowerCase('en-US')
  ] ?? 'application/octet-stream';
}

function parseByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || fileSize <= 0) {
    return null;
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize) {
    return null;
  }

  const requestedEnd = endText ? Number(endText) : fileSize - 1;
  if (
    !Number.isSafeInteger(requestedEnd) ||
    requestedEnd < start
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}

function rangeNotSatisfiable(fileSize: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${fileSize}`,
    },
  });
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
      !getMediaKind(sourcePath) &&
      !isSupportedNarrationPath(sourcePath)
    ) {
      return new Response(null, { status: 400 });
    }

    try {
      const rangeHeader = request.headers.get('Range');
      if (!rangeHeader) {
        const response = await net.fetch(pathToFileURL(sourcePath).toString(), {
          headers: request.headers,
        });
        const headers = new Headers(response.headers);
        headers.set('Accept-Ranges', 'bytes');
        return new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        });
      }

      const fileSize = (await stat(sourcePath)).size;
      const byteRange = parseByteRange(rangeHeader, fileSize);
      if (!byteRange) {
        return rangeNotSatisfiable(fileSize);
      }

      const contentLength = byteRange.end - byteRange.start + 1;
      const body = Readable.toWeb(
        createReadStream(sourcePath, {
          start: byteRange.start,
          end: byteRange.end,
        }),
      ) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range':
            `bytes ${byteRange.start}-${byteRange.end}/${fileSize}`,
          'Content-Length': String(contentLength),
          'Content-Type': getContentType(sourcePath),
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
