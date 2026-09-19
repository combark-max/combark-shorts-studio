import { describe, expect, it } from 'vitest';
import { desktopApi } from '../../src/preload/api';

describe('desktopApi', () => {
  it('exposes only the approved initial surface', () => {
    expect(desktopApi).toEqual({
      platform: 'win32',
    });

    expect(Object.keys(desktopApi)).toEqual(['platform']);
  });
});