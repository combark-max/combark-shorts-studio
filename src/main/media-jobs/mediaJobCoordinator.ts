export type MediaJobKind =
  | 'export'
  | 'contact-sheet-video'
  | 'diagnostics'
  | 'stabilization-preview'
  | 'final-correction';

export class MediaJobBusyError extends Error {
  constructor(public readonly activeKind: MediaJobKind) {
    super('다른 미디어 작업이 이미 진행 중입니다.');
    this.name = 'MediaJobBusyError';
  }
}

export interface MediaJobLease {
  readonly kind: MediaJobKind;
  readonly owner: object;
  release(): void;
}

interface ActiveJob {
  token: symbol;
  kind: MediaJobKind;
  owner: object;
  cancel?: () => void;
  cancellationRequested: boolean;
}

export class MediaJobCoordinator {
  private active: ActiveJob | null = null;
  private readonly idleListeners = new Set<() => void>();

  tryAcquire(kind: MediaJobKind, owner: object, cancel?: () => void): MediaJobLease {
    if (this.active) throw new MediaJobBusyError(this.active.kind);
    const token = Symbol(kind);
    this.active = { token, kind, owner, cancel, cancellationRequested: false };
    let released = false;
    return {
      kind,
      owner,
      release: () => {
        if (released) return;
        released = true;
        if (this.active?.token !== token) return;
        this.active = null;
        for (const listener of this.idleListeners) listener();
        this.idleListeners.clear();
      },
    };
  }

  activeJob(): Readonly<Pick<ActiveJob, 'kind' | 'owner'>> | null {
    return this.active ? { kind: this.active.kind, owner: this.active.owner } : null;
  }

  cancelActive(): void {
    if (!this.active || this.active.cancellationRequested) return;
    this.active.cancellationRequested = true;
    this.active.cancel?.();
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.active) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (idle: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.idleListeners.delete(onIdle);
        resolve(idle);
      };
      const onIdle = (): void => finish(true);
      const timeout = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      this.idleListeners.add(onIdle);
    });
  }
}
