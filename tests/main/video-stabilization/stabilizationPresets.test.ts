import { describe, expect, it } from 'vitest';

import {
  finalCorrectionCapabilities,
  getFinalCorrectionPreset,
  getPreviewStabilizationPreset,
} from '../../../src/main/video-stabilization/stabilizationPresets';

describe('shared stabilization presets', () => {
  it('keeps the Phase 2-A weak preview on the T01-verified basic preset', () => {
    expect(getPreviewStabilizationPreset('weak')).toEqual(getFinalCorrectionPreset('basic'));
    expect(getFinalCorrectionPreset('basic')).toEqual({
      strength: 'weak',
      detect: { shakiness: 5, accuracy: 9, stepsize: 12, mincontrast: 0.25 },
      transform: {
        smoothing: 8,
        interpol: 'bicubic',
        maxshift: 24,
        maxangleRadians: 0.03,
      },
    });
  });

  it('uses only the existing Phase 2-A medium values for the strong candidate', () => {
    expect(getPreviewStabilizationPreset('medium')).toEqual(getFinalCorrectionPreset('strong'));
    expect(getFinalCorrectionPreset('strong')).toMatchObject({
      detect: { shakiness: 5, accuracy: 12, stepsize: 6, mincontrast: 0.25 },
      transform: { smoothing: 15, maxshift: 32, maxangleRadians: 0.05 },
    });
  });

  it('enables strong after the full-MP4 acceptance record is complete', () => {
    expect(finalCorrectionCapabilities()).toEqual({ basic: true, strong: true });
  });
});
