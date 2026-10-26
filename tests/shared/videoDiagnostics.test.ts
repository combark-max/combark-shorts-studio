import { describe, expect, it } from 'vitest';

import {
  dedupeSceneCandidates,
  diagnosticCandidateKey,
  mergeDiagnosticEvents,
  severityForScore,
  sortDiagnosticCandidates,
  suppressEventsNearScenes,
  type DiagnosticCandidate,
  type RawDiagnosticEvent,
} from '../../src/shared/videoDiagnostics';

function event(
  type: RawDiagnosticEvent['type'],
  timeMs: number,
  scoreMultiple: number | null,
  rawScore = scoreMultiple ?? 0,
): RawDiagnosticEvent {
  return { type, timeMs, scoreMultiple, rawScore, confidence: 'medium' };
}

describe('video diagnostic severity', () => {
  it.each([
    [1, 'low'],
    [1.999, 'low'],
    [2, 'medium'],
    [3.999, 'medium'],
    [4, 'high'],
  ] as const)('maps %s to %s', (score, severity) => {
    expect(severityForScore(score)).toBe(severity);
  });
});

describe('diagnostic candidate identity', () => {
  const candidate = {
    type: 'motion-jitter' as const,
    startMs: 1_000.4,
    endMs: 1_500.4,
    peakMs: 1_250.4,
  };

  it('uses only type and normalized integer time bounds', () => {
    expect(diagnosticCandidateKey(candidate)).toBe(
      diagnosticCandidateKey({ ...candidate, startMs: 1_000.49 }),
    );
  });

  it('does not collide when an identity field changes', () => {
    const key = diagnosticCandidateKey(candidate);
    expect(diagnosticCandidateKey({ ...candidate, type: 'motion-jump' })).not.toBe(key);
    expect(diagnosticCandidateKey({ ...candidate, peakMs: 1_251 })).not.toBe(key);
  });
});

describe('video diagnostic event post-processing', () => {
  it('deduplicates nearby scene candidates and keeps the strongest event', () => {
    const result = dedupeSceneCandidates([
      event('scene-change', 10_000, null, 12),
      event('scene-change', 10_400, null, 18),
      event('scene-change', 11_000, null, 14),
    ]);

    expect(result.map(({ timeMs, rawScore }) => ({ timeMs, rawScore }))).toEqual([
      { timeMs: 10_400, rawScore: 18 },
      { timeMs: 11_000, rawScore: 14 },
    ]);
  });

  it('suppresses non-scene events near a scene while retaining scene events', () => {
    const scenes = [event('scene-change', 10_000, null, 15)];
    const result = suppressEventsNearScenes([
      event('brightness-change', 9_500, 1.2),
      event('frame-change', 10_499, 2),
      event('motion-jump', 10_501, 3),
      ...scenes,
    ], scenes);

    expect(result.map(({ type, timeMs }) => ({ type, timeMs }))).toEqual([
      { type: 'scene-change', timeMs: 10_000 },
      { type: 'motion-jump', timeMs: 10_501 },
    ]);
  });

  it('merges same-type events and uses the strongest event for the peak and severity', () => {
    const [candidate] = mergeDiagnosticEvents([
      event('frame-change', 1_000, 1.5),
      event('frame-change', 1_500, 4.2),
      event('frame-change', 2_001, 2.1),
    ]);

    expect(candidate).toMatchObject({
      type: 'frame-change',
      startMs: 1_000,
      endMs: 1_500,
      peakMs: 1_500,
      severity: 'high',
      scoreMultiple: 4.2,
    });
  });

  it('uses a 750ms merge gap for motion jitter', () => {
    const result = mergeDiagnosticEvents([
      event('motion-jitter', 1_000, 1.2),
      event('motion-jitter', 1_750, 1.8),
      event('motion-jitter', 2_501, 2.2),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ startMs: 1_000, endMs: 1_750 });
  });

  it('sorts by peak time and then diagnostic type priority', () => {
    const candidates: DiagnosticCandidate[] = [
      { type: 'brightness-change', startMs: 100, endMs: 100, peakMs: 100, severity: 'low', scoreMultiple: 1, scoreLabel: '', confidence: null },
      { type: 'scene-change', startMs: 100, endMs: 100, peakMs: 100, severity: 'info', scoreMultiple: null, scoreLabel: '', confidence: null },
      { type: 'motion-jump', startMs: 50, endMs: 50, peakMs: 50, severity: 'medium', scoreMultiple: 2, scoreLabel: '', confidence: 'medium' },
    ];

    expect(sortDiagnosticCandidates(candidates).map(({ type }) => type)).toEqual([
      'motion-jump',
      'scene-change',
      'brightness-change',
    ]);
  });

  it('drops invalid numeric events before they can cross the IPC contract', () => {
    const invalid = [
      event('frame-change', -1, 2),
      event('frame-change', Number.NaN, 2),
      event('frame-change', 10, Number.POSITIVE_INFINITY),
      event('scene-change', 20, null, Number.NaN),
    ];

    expect(mergeDiagnosticEvents(invalid)).toEqual([]);
  });
});
