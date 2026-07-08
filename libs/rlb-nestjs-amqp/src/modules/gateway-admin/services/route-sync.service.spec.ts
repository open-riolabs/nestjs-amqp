import { ConflictError } from '../../../common';
import { RouteSyncService } from './route-sync.service';

// A single new route (no existing row for the owner) → diffRoutes produces an INSERT upsert,
// which is where the routeKey-unique race is reconciled.
const ROUTE = { method: 'GET', path: '/race', topic: 't', action: 'a', mode: 'rpc' as const };
const KEY = 'GET /race';

const mkPaths = (over: any = {}) => ({
  findByOwner: jest.fn(async () => []),          // owner has no rows yet → the route is `added`
  findByRouteKey: jest.fn(async () => []),
  insert: jest.fn(async (m: any) => ({ _id: 'new', ...m })),
  updateById: jest.fn(async (id: string, m: any) => ({ _id: id, ...m })),
  ...over,
}) as any;

const mkLogs = () => ({ insert: jest.fn(async (e: any) => e) }) as any;
const mkService = (paths: any, logs: any) => new RouteSyncService(
  {} as any,                                     // amqp — only used in onApplicationBootstrap
  { publishMessage: jest.fn(async () => undefined) } as any, // broker — reload broadcast
  paths, logs,
  { paths: [], reloadTopic: undefined } as any,  // no YAML routes; no reloadTopic → reload just warns
);
const events = (logs: any) => logs.insert.mock.calls.map((c: any[]) => c[0]?.event);

describe('RouteSyncService — insert-race reconciliation on the unique routeKey index', () => {
  it('same owner won the race → idempotent updateById (not a duplicate insert), journaled as updated', async () => {
    // Race: reserve-check sees no clash (1st findByRouteKey → []), then insert loses to a concurrent
    // insert of the SAME service (2nd findByRouteKey → a row owned by us).
    const paths = mkPaths({
      insert: jest.fn().mockRejectedValue(new ConflictError('duplicate routeKey')),
      findByRouteKey: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ _id: 'winner', owner: 'svc-a', routeKey: KEY }]),
    });
    const logs = mkLogs();
    await (mkService(paths, logs) as any).handle({ service: 'svc-a', routes: [ROUTE] });

    expect(paths.insert).toHaveBeenCalledTimes(1);
    expect(paths.updateById).toHaveBeenCalledWith('winner', expect.objectContaining({
      owner: 'svc-a', routeKey: KEY, source: 'microservice',
    }));
    expect(events(logs)).toContain('updated');
    expect(events(logs)).not.toContain('collision');
    expect(events(logs)).not.toContain('added');
  });

  it('a DIFFERENT owner won the race → skip + journal collision, never clobber the winner', async () => {
    const paths = mkPaths({
      insert: jest.fn().mockRejectedValue(new ConflictError('duplicate routeKey')),
      findByRouteKey: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ _id: 'winner', owner: 'svc-b', routeKey: KEY }]),
    });
    const logs = mkLogs();
    await (mkService(paths, logs) as any).handle({ service: 'svc-a', routes: [ROUTE] });

    expect(paths.updateById).not.toHaveBeenCalled();
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'collision', routeKey: KEY, conflictWith: 'svc-b',
    }));
    expect(events(logs)).not.toContain('added');
    expect(events(logs)).not.toContain('updated');
  });

  it('a non-ConflictError from insert is NOT treated as a race (no reconcile, no collision journal)', async () => {
    const paths = mkPaths({
      insert: jest.fn().mockRejectedValue(new Error('db unavailable')),
    });
    const logs = mkLogs();
    // handle() swallows the error (logs + acks); we assert the reconcile branch was not entered.
    await (mkService(paths, logs) as any).handle({ service: 'svc-a', routes: [ROUTE] });

    expect(paths.findByRouteKey).toHaveBeenCalledTimes(1); // reserve-check only; catch re-throws
    expect(paths.updateById).not.toHaveBeenCalled();
    expect(events(logs)).not.toContain('collision');
  });
});
