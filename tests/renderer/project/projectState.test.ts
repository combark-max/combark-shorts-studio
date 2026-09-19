import { describe, expect, it } from 'vitest';
import { createInitialProjectState } from '../../../src/renderer/project/projectState';

describe('createInitialProjectState', () => {
  it('creates a clean state from a new project', () => {
    const state = createInitialProjectState();

    expect(state.project.name).toBe('새 프로젝트');
    expect(state.filePath).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.lastSavedAt).toBeNull();
  });
});