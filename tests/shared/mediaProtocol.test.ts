import { describe, expect, it } from 'vitest';

import {
  createMediaUrl,
  MEDIA_PROTOCOL_SCHEME,
} from '../../src/shared/mediaProtocol';

describe('mediaProtocol', () => {
  it('encodes a Windows media path without exposing it as URL structure', () => {
    const mediaUrl = createMediaUrl('C:\\My Media\\사진 1.jpg');
    const parsed = new URL(mediaUrl);

    expect(parsed.protocol).toBe(`${MEDIA_PROTOCOL_SCHEME}:`);
    expect(parsed.host).toBe('local');
    expect(parsed.searchParams.get('path')).toBe('C:\\My Media\\사진 1.jpg');
  });
});
