import { defaultIfEmpty, finalize, firstValueFrom, MonoTypeOperatorFunction, ReplaySubject, Subject, takeUntil } from 'rxjs';

/**
 * Wraps a set of RxJS pipelines belonging to a single service so they can be
 * drained on shutdown. Each pipeline gets the `takeUntilShutdown()` operator
 * as the last step before `.subscribe()`; `drain()` then signals all of them
 * and waits for them to complete (buffered items in concatMap/mergeMap finish).
 */
export class DrainableStream {
  private readonly shutdown$ = new Subject<void>();
  private readonly drained$ = new ReplaySubject<void>(1);
  private pendingStreams = 0;

  takeUntilShutdown<T>(): MonoTypeOperatorFunction<T> {
    this.pendingStreams++;
    return source$ => source$.pipe(
      takeUntil(this.shutdown$),
      finalize(() => {
        if (--this.pendingStreams === 0) {
          this.drained$.next();
          this.drained$.complete();
        }
      })
    );
  }

  async drain(): Promise<void> {
    this.shutdown$.next();
    this.shutdown$.complete();
    if (this.pendingStreams > 0) {
      await firstValueFrom(this.drained$.pipe(defaultIfEmpty(undefined)));
    }
  }
}
