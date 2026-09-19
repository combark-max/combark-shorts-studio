import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  APP_NAME,
  DEFAULT_PROJECT_SETTINGS,
  PROJECT_EXTENSION,
} from '../../src/shared/appInfo';

describe('appInfo', () => {
  it('uses the approved product identity and shorts defaults', () => {
    expect(APP_NAME).toBe('Combark Shorts Studio');
    expect(APP_ID).toBe('com.combark.shortsstudio');
    expect(PROJECT_EXTENSION).toBe('.cssproj');
    expect(DEFAULT_PROJECT_SETTINGS).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
    });
  });
});