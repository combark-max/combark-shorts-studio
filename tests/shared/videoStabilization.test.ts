import { describe, expect, it } from 'vitest';

import {
  parseStabilizationPreviewRequest,
  type StabilizationPreviewRequest,
} from '../../src/shared/videoStabilization';

const validRequest: StabilizationPreviewRequest = {
  sourcePath: 'C:\\video.mp4',
  candidateKey: 'motion-jitter:1000:1200:1100',
  selectionMode: 'range',
  requestedStartMs: 1_000,
  requestedEndMs: 6_000,
  sceneBoundaryConfirmed: true,
  scaleMotionConfirmed: false,
  strength: 'weak',
  zoomPercent: 2,
  encoder: 'libx264',
  includeAudio: true,
};

describe('stabilization preview request contract', () => {
  it('retains explicit scene and scale confirmation flags', () => {
    expect(parseStabilizationPreviewRequest(validRequest)).toMatchObject({
      sceneBoundaryConfirmed: true,
      scaleMotionConfirmed: false,
    });
  });

  it.each([
    ['strength', 'strong'],
    ['zoomPercent', 4],
    ['encoder', 'nvenc'],
    ['selectionMode', 'whole-video'],
  ])('rejects an unsupported %s value', (field, value) => {
    expect(() => parseStabilizationPreviewRequest({
      ...validRequest,
      [field]: value,
    })).toThrow('안정화');
  });

  it('rejects missing confirmation flags instead of assuming consent', () => {
    const request: Partial<StabilizationPreviewRequest> = { ...validRequest };
    delete request.sceneBoundaryConfirmed;
    expect(() => parseStabilizationPreviewRequest(request)).toThrow('확인');
  });
});
