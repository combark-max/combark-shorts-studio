import { describe, expect, it, vi } from 'vitest';

import {
  MediaJobBusyError,
  MediaJobCoordinator,
} from '../../../src/main/media-jobs/mediaJobCoordinator';

describe('MediaJobCoordinator', () => {
  it('allows only one global lease and exposes its owner and kind', () => {
    const coordinator = new MediaJobCoordinator();
    const owner = {};
    const lease = coordinator.tryAcquire('export', owner);
    expect(coordinator.activeJob()).toMatchObject({ kind: 'export', owner });
    expect(() => coordinator.tryAcquire('diagnostics', {})).toThrow(MediaJobBusyError);
    lease.release();
    expect(coordinator.activeJob()).toBeNull();
  });

  it('makes release idempotent and prevents stale release from clearing a newer job', () => {
    const coordinator = new MediaJobCoordinator();
    const first = coordinator.tryAcquire('export', {});
    first.release();
    const second = coordinator.tryAcquire('contact-sheet-video', {});
    first.release();
    expect(coordinator.activeJob()?.kind).toBe('contact-sheet-video');
    second.release();
  });

  it('requests cancellation and resolves idle wait after release', async () => {
    const coordinator = new MediaJobCoordinator();
    const cancel = vi.fn();
    const lease = coordinator.tryAcquire('stabilization-preview', {}, cancel);
    coordinator.cancelActive();
    coordinator.cancelActive();
    expect(cancel).toHaveBeenCalledTimes(1);
    const idle = coordinator.waitForIdle(100);
    lease.release();
    await expect(idle).resolves.toBe(true);
  });

  it('bounds shutdown waiting when a job cannot release', async () => {
    const coordinator = new MediaJobCoordinator();
    coordinator.tryAcquire('diagnostics', {}, vi.fn());
    await expect(coordinator.waitForIdle(1)).resolves.toBe(false);
  });
});
