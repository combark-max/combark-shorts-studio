import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { describe, expect, it } from 'vitest';

import config from '../forge.config';

describe('Forge development content security policy', () => {
  it('allows images and videos served by the local media protocol', () => {
    const webpackPlugin = config.plugins?.find(
      (plugin) => plugin instanceof WebpackPlugin,
    ) as unknown as {
      config: {
        devContentSecurityPolicy?: string;
      };
    };

    const contentSecurityPolicy = webpackPlugin.config.devContentSecurityPolicy;

    expect(contentSecurityPolicy).toContain(
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' data:",
    );
    expect(contentSecurityPolicy).toContain(
      "img-src 'self' data: combark-media:",
    );
    expect(contentSecurityPolicy).toContain(
      "media-src 'self' combark-media:",
    );
  });
});

describe('Forge FFmpeg packaging', () => {
  it('copies ffmpeg.exe outside ASAR as an extra resource', () => {
    expect(config.packagerConfig?.extraResource).toContain(
      'node_modules/ffmpeg-static/ffmpeg.exe',
    );
  });
});
