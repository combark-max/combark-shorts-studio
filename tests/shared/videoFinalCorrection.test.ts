import { describe, expect, it } from 'vitest';

import {
  parseVideoFinalCorrectionRequest,
  type VideoFinalCorrectionRequest,
} from '../../src/shared/videoFinalCorrection';

const validRequest: VideoFinalCorrectionRequest = {
  sourcePath: 'C:\\video\\source.mp4',
  outputPath: 'C:\\video\\source-corrected.mp4',
  method: 'basic',
};

describe('video final correction request contract', () => {
  it('accepts explicit basic and strong methods', () => {
    expect(parseVideoFinalCorrectionRequest(validRequest)).toEqual(validRequest);
    expect(parseVideoFinalCorrectionRequest({ ...validRequest, method: 'strong' })).toMatchObject({
      method: 'strong',
    });
  });

  it.each([
    [{ ...validRequest, sourcePath: '' }, '경로'],
    [{ ...validRequest, outputPath: '' }, '경로'],
    [{ ...validRequest, method: 'person-background' }, '방식'],
    [{ sourcePath: validRequest.sourcePath, method: 'basic' }, '경로'],
  ])('rejects malformed or excluded correction requests', (request, message) => {
    expect(() => parseVideoFinalCorrectionRequest(request)).toThrow(message);
  });
});
