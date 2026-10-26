import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { win32 } from 'node:path';

export interface StoredPreview {
  id: string;
  directory: string;
  path: string;
}

export interface PreviewStoreDependencies {
  removeDirectory?: (path: string) => Promise<void>;
  createId?: () => string;
  onCleanupError?: (error: unknown) => void;
}

export class PreviewStore {
  private readonly byOwner = new Map<object, StoredPreview>();
  private readonly removeDirectory: (path: string) => Promise<void>;
  private readonly createId: () => string;
  private readonly onCleanupError: (error: unknown) => void;

  constructor(dependencies: PreviewStoreDependencies = {}) {
    this.removeDirectory = dependencies.removeDirectory ??
      ((path) => rm(path, { recursive: true, force: true }));
    this.createId = dependencies.createId ?? randomUUID;
    this.onCleanupError = dependencies.onCleanupError ?? ((error) => {
      console.warn('Stabilization preview cleanup failed.', error);
    });
  }

  async register(owner: object, directory: string, path: string): Promise<string> {
    this.assertOwnedTemporaryPath(directory, path);
    const previous = this.byOwner.get(owner);
    const preview: StoredPreview = {
      id: this.createId(),
      directory: win32.normalize(directory),
      path: win32.normalize(path),
    };
    this.byOwner.set(owner, preview);
    if (previous) await this.cleanup(previous);
    return preview.id;
  }

  get(owner: object, previewId: string): StoredPreview | null {
    const preview = this.byOwner.get(owner);
    return preview?.id === previewId ? { ...preview } : null;
  }

  async dispose(owner: object, previewId: string): Promise<boolean> {
    const preview = this.byOwner.get(owner);
    if (!preview || preview.id !== previewId) return false;
    this.byOwner.delete(owner);
    await this.cleanup(preview);
    return true;
  }

  async disposeOwner(owner: object): Promise<void> {
    const preview = this.byOwner.get(owner);
    if (!preview) return;
    this.byOwner.delete(owner);
    await this.cleanup(preview);
  }

  async disposeAll(): Promise<void> {
    const previews = [...this.byOwner.values()];
    this.byOwner.clear();
    await Promise.all(previews.map((preview) => this.cleanup(preview)));
  }

  private assertOwnedTemporaryPath(directory: string, path: string): void {
    const normalizedDirectory = win32.normalize(directory);
    const normalizedPath = win32.normalize(path);
    if (!win32.basename(normalizedDirectory).startsWith('combark-stabilization-preview-')) {
      throw new Error('안정화 임시 디렉터리가 아닙니다.');
    }
    const relative = win32.relative(normalizedDirectory, normalizedPath);
    if (relative.length === 0 || relative.startsWith('..') || win32.isAbsolute(relative)) {
      throw new Error('안정화 임시 결과 경로가 안전하지 않습니다.');
    }
  }

  private async cleanup(preview: StoredPreview): Promise<void> {
    try {
      await this.removeDirectory(preview.directory);
    } catch (error) {
      this.onCleanupError(error);
    }
  }
}
