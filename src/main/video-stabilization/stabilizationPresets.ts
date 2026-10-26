import type { VideoFinalCorrectionCapabilities, VideoFinalCorrectionMethod } from '../../shared/videoFinalCorrection';
import type { StabilizationStrength } from '../../shared/videoStabilization';
import type { StabilizationPreset } from './ffmpegStabilization';

const BASIC_PRESET: StabilizationPreset = {
  strength: 'weak',
  detect: { shakiness: 5, accuracy: 9, stepsize: 12, mincontrast: 0.25 },
  transform: {
    smoothing: 8,
    interpol: 'bicubic',
    maxshift: 24,
    maxangleRadians: 0.03,
  },
};

const STRONG_CANDIDATE_PRESET: StabilizationPreset = {
  strength: 'medium',
  detect: { shakiness: 5, accuracy: 12, stepsize: 6, mincontrast: 0.25 },
  transform: {
    smoothing: 15,
    interpol: 'bicubic',
    maxshift: 32,
    maxangleRadians: 0.05,
  },
};

export function getPreviewStabilizationPreset(
  strength: Exclude<StabilizationStrength, 'off'>,
): StabilizationPreset {
  return strength === 'weak' ? BASIC_PRESET : STRONG_CANDIDATE_PRESET;
}

export function getFinalCorrectionPreset(method: VideoFinalCorrectionMethod): StabilizationPreset {
  return method === 'basic' ? BASIC_PRESET : STRONG_CANDIDATE_PRESET;
}

export function finalCorrectionCapabilities(): VideoFinalCorrectionCapabilities {
  return { basic: true, strong: true };
}
