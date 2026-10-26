import { describe, expect, it, vi } from 'vitest';

import { PreviewStore } from '../../../src/main/video-stabilization/previewStore';

describe('PreviewStore', () => {
  it('keeps one opaque preview per owner and cleans the replaced directory', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const store = new PreviewStore({
      removeDirectory,
      createId: vi.fn().mockReturnValueOnce('opaque-one').mockReturnValueOnce('opaque-two'),
    });
    const owner = {};
    const first = await store.register(owner, 'C:\\Temp\\combark-stabilization-preview-one', 'C:\\Temp\\combark-stabilization-preview-one\\final.mp4');
    const second = await store.register(owner, 'C:\\Temp\\combark-stabilization-preview-two', 'C:\\Temp\\combark-stabilization-preview-two\\final.mp4');
    expect(first).toBe('opaque-one');
    expect(second).toBe('opaque-two');
    expect(store.get(owner, first)).toBeNull();
    expect(store.get(owner, second)?.path).toMatch(/final\.mp4$/);
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\combark-stabilization-preview-one');
  });

  it('refuses a wrong owner and makes disposal idempotent', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);
    const store = new PreviewStore({ removeDirectory, createId: () => 'opaque' });
    const owner = {};
    await store.register(owner, 'C:\\Temp\\combark-stabilization-preview-job', 'C:\\Temp\\combark-stabilization-preview-job\\final.mp4');
    await expect(store.dispose({}, 'opaque')).resolves.toBe(false);
    await expect(store.dispose(owner, 'opaque')).resolves.toBe(true);
    await expect(store.dispose(owner, 'opaque')).resolves.toBe(false);
    expect(removeDirectory).toHaveBeenCalledTimes(1);
  });

  it('rejects arbitrary paths before anything can be deleted', async () => {
    const removeDirectory = vi.fn();
    const store = new PreviewStore({ removeDirectory });
    await expect(store.register({}, 'C:\\Users\\user\\Videos', 'C:\\Users\\user\\Videos\\original.mp4'))
      .rejects.toThrow('임시');
    expect(removeDirectory).not.toHaveBeenCalled();
  });

  it('disposes owner and app previews while reporting cleanup failures', async () => {
    const cleanupError = new Error('locked');
    const onCleanupError = vi.fn();
    const removeDirectory = vi.fn()
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValue(undefined);
    const store = new PreviewStore({
      removeDirectory,
      onCleanupError,
      createId: vi.fn().mockReturnValueOnce('one').mockReturnValueOnce('two'),
    });
    const firstOwner = {};
    const secondOwner = {};
    await store.register(firstOwner, 'C:\\Temp\\combark-stabilization-preview-one', 'C:\\Temp\\combark-stabilization-preview-one\\final.mp4');
    await store.register(secondOwner, 'C:\\Temp\\combark-stabilization-preview-two', 'C:\\Temp\\combark-stabilization-preview-two\\final.mp4');
    await store.disposeOwner(firstOwner);
    expect(store.get(firstOwner, 'one')).toBeNull();
    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
    await store.disposeAll();
    expect(store.get(secondOwner, 'two')).toBeNull();
  });
});
