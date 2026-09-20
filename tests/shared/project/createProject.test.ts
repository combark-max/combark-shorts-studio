import { describe, expect, it } from 'vitest';
import { createNewProject } from '../../../src/shared/project/createProject';

describe('createNewProject', () => {
  it('creates a v2 project document with an empty media list', () => {
    const project = createNewProject();

    expect(project.schemaVersion).toBe(2);
    expect(project.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(project.name).toBe('새 프로젝트');
    expect(project.createdAt).toBe(project.updatedAt);
    expect(project.settings).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
    });

    expect(project.media).toEqual([]);
    expect(project).not.toHaveProperty('timeline');
    expect(project).not.toHaveProperty('tracks');
    expect(project).not.toHaveProperty('clips');
  });

  it('supports a custom project name', () => {
    const project = createNewProject('첫 쇼츠');

    expect(project.name).toBe('첫 쇼츠');
  });
});
