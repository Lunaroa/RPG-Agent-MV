export interface LatestAsyncToken<T> {
  readonly sequence: number;
  readonly value: T;
}

export type LatestAsyncOutcome = 'completed' | 'superseded';

export interface LatestAsyncContext<T> {
  readonly token: LatestAsyncToken<T>;
  isCurrent(): boolean;
}

/**
 * Serializes state-changing work while allowing preparation to happen in parallel.
 * A task that has not started is skipped when a newer token exists. A running task
 * can use isCurrent() after each await to avoid publishing a late result.
 */
export class LatestAsyncCoordinator<T> {
  private sequence = 0;
  private currentToken: LatestAsyncToken<T> | null = null;
  private queue: Promise<void> = Promise.resolve();

  begin(value: T): LatestAsyncToken<T> {
    const token = Object.freeze({ sequence: ++this.sequence, value });
    this.currentToken = token;
    return token;
  }

  invalidate(value: T): LatestAsyncToken<T> {
    return this.begin(value);
  }

  current(): LatestAsyncToken<T> | null {
    return this.currentToken;
  }

  isCurrent(token: LatestAsyncToken<T>): boolean {
    return this.currentToken?.sequence === token.sequence;
  }

  runExclusive(
    token: LatestAsyncToken<T>,
    task: (context: LatestAsyncContext<T>) => Promise<void> | void,
  ): Promise<LatestAsyncOutcome> {
    const run = this.queue.then(async () => {
      if (!this.isCurrent(token)) return 'superseded' as const;
      const context: LatestAsyncContext<T> = {
        token,
        isCurrent: () => this.isCurrent(token),
      };
      await task(context);
      return this.isCurrent(token) ? 'completed' as const : 'superseded' as const;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async drain(): Promise<void> {
    await this.queue;
  }
}
