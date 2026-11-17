import { Logger } from '@nestjs/common';
import { GatewayPathService } from './gateway-path.service';

const mkRepo = (over: any = {}) => ({
  insert: jest.fn(async (m: any) => ({ _id: 'g1', ...m })),
  findById: jest.fn(async () => undefined),
  findByRouteKey: jest.fn(async () => []),
  updateById: jest.fn(async (id: string, m: any) => ({ _id: id, ...m })),
  removeById: jest.fn(async (id: string) => ({ _id: id, routeKey: 'GET /x', method: 'GET', path: '/x', owner: 'svc' })),
  search: jest.fn(async () => []),
  ...over,
}) as any;

const mkLogs = () => ({ insert: jest.fn(async (e: any) => e), list: jest.fn(), query: jest.fn(async () => ({ page: 1, limit: 20, total: 0, data: [] })) }) as any;

describe('GatewayPathService — user CRUD audit (actor + changes)', () => {
  it('create: forces source=user and journals event=created with actor=userId', async () => {
    const repo = mkRepo();
    const logs = mkLogs();
    await new GatewayPathService(repo, logs).create({ name: 'n', method: 'GET', path: '/x', topic: 't' } as any, 'user-1');
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ source: 'user', modified: false, routeKey: 'GET /x' }));
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({ actor: 'user-1', event: 'created', routeKey: 'GET /x' }));
  });

  it('update: a SOFT field (actions) does NOT lock — modified stays false, tracked in userOverrides; changes reflect existing-vs-merged', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', actions: ['admin'], timeout: 5000, owner: 'svc', routeKey: 'GET /x' };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    const logs = mkLogs();
    // Partial body: only `actions` is sent; `timeout` must NOT appear as removed.
    await new GatewayPathService(repo, logs).update({ id: 'g1', actions: ['booking-read'] } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ modified: false, userOverrides: ['actions'] }));
    const entry = logs.insert.mock.calls[0][0];
    expect(entry).toMatchObject({ actor: 'user-2', event: 'updated', routeKey: 'GET /x' });
    expect(entry.changes).toEqual([{ field: 'actions', added: ['booking-read'], removed: ['admin'] }]);
  });

  it('update: a HARD field (auth) locks the whole route (modified=true)', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', auth: null, owner: 'svc', routeKey: 'GET /x' };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    await new GatewayPathService(repo, mkLogs()).update({ id: 'g1', auth: 'jwt' } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ modified: true }));
  });

  it('update: disabling a route is a SOFT override (enabled), not a lock', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', enabled: true, owner: 'svc', routeKey: 'GET /x' };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    await new GatewayPathService(repo, mkLogs()).update({ id: 'g1', enabled: false } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ modified: false, userOverrides: ['enabled'] }));
  });

  it('update: releaseOverrides resets a single field (MS resumes it) without touching the others', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', timeout: 9000, owner: 'svc', routeKey: 'GET /x', userOverrides: ['timeout', 'redirect'] };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    await new GatewayPathService(repo, mkLogs()).update({ id: 'g1', releaseOverrides: ['timeout'] } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ userOverrides: ['redirect'] }));
  });

  it('create: stores a valid rateLimit as sent', async () => {
    const repo = mkRepo();
    const rateLimit = { requestsPerSecond: 2, burst: 10 };
    await new GatewayPathService(repo, mkLogs()).create({ name: 'n', method: 'GET', path: '/x', topic: 't', rateLimit } as any, 'user-1');
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ rateLimit }));
  });

  it.each([
    ['create', (svc: GatewayPathService) => svc.create({ name: 'n', method: 'GET', path: '/x', topic: 't', rateLimit: { requestsPerSecond: -1 } } as any, 'u')],
    ['update', (svc: GatewayPathService) => svc.update({ id: 'g1', rateLimit: { requestsPerSecond: 1, burst: 0.5 } } as any, 'u')],
    ['update (unknown key)', (svc: GatewayPathService) => svc.update({ id: 'g1', rateLimit: { rps: 1 } } as any, 'u')],
  ])('%s: a malformed rateLimit is a 400 and nothing is written', async (_label, call) => {
    const repo = mkRepo();
    await expect(call(new GatewayPathService(repo, mkLogs()))).rejects.toMatchObject({ name: 'BadRequestError' });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.updateById).not.toHaveBeenCalled();
  });

  it('update: rateLimit is a SOFT field — an auto-discovered route is not locked, and the change is journaled', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', owner: 'svc', routeKey: 'GET /x', source: 'microservice' };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    const logs = mkLogs();
    await new GatewayPathService(repo, logs).update({ id: 'g1', rateLimit: { requestsPerSecond: 1, burst: 5 } } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ modified: false, userOverrides: ['rateLimit'], rateLimit: { requestsPerSecond: 1, burst: 5 } }));
    expect(logs.insert.mock.calls[0][0].changes).toEqual([{ field: 'rateLimit', added: [{ requestsPerSecond: 1, burst: 5 }], removed: [] }]);
  });

  it.each([
    ['a flattened $set merged it', { enabled: false }, { enabled: false, requestsPerSecond: 5 }],
    ['a strict schema dropped it', null, undefined],
  ])('update: logs an error when the repository did not store rateLimit as sent (%s)', async (_label, before, stored) => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', rateLimit: before, routeKey: 'GET /x', source: 'user' };
    const repo = mkRepo({
      findById: jest.fn(async () => existing),
      updateById: jest.fn(async (id: string, m: any) => ({ _id: id, ...m, rateLimit: stored })),
    });
    await new GatewayPathService(repo, mkLogs()).update({ id: 'g1', rateLimit: { requestsPerSecond: 5 } } as any, 'user-2');
    expect(error.mock.calls.some(([m]) => String(m).includes('rateLimit not stored as sent'))).toBe(true);
    error.mockRestore();
  });

  it('create/update: no error when the repository stores rateLimit as sent', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repo = mkRepo({ findById: jest.fn(async () => ({ _id: 'g1', method: 'GET', path: '/x', routeKey: 'GET /x' })) });
    const svc = new GatewayPathService(repo, mkLogs());
    await svc.create({ name: 'n', method: 'GET', path: '/x', topic: 't', rateLimit: { burst: 2, requestsPerSecond: 1 } } as any, 'u');
    await svc.update({ id: 'g1', rateLimit: null } as any, 'u');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('update: rateLimit null removes the own rule', async () => {
    const existing = { _id: 'g1', method: 'GET', path: '/x', topic: 't', action: 'a', mode: 'rpc', dataSource: 'query', rateLimit: { requestsPerSecond: 1 }, routeKey: 'GET /x', source: 'user' };
    const repo = mkRepo({ findById: jest.fn(async () => existing) });
    const logs = mkLogs();
    await new GatewayPathService(repo, logs).update({ id: 'g1', rateLimit: null } as any, 'user-2');
    expect(repo.updateById).toHaveBeenCalledWith('g1', expect.objectContaining({ rateLimit: null }));
    expect(logs.insert.mock.calls[0][0].changes).toEqual([{ field: 'rateLimit', added: [], removed: [{ requestsPerSecond: 1 }] }]);
  });

  it('delete: journals event=deleted; a missing X-GTW-AUTH-USERID header → actor=unknown', async () => {
    const repo = mkRepo();
    const logs = mkLogs();
    await new GatewayPathService(repo, logs).remove('g1');
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({ actor: 'unknown', event: 'deleted', routeKey: 'GET /x' }));
  });

  it('logList reads the journal with the default limit', async () => {
    const repo = mkRepo();
    const logs = mkLogs();
    logs.list = jest.fn(async () => [{ event: 'created', actor: 'u1' }]);
    const out = await new GatewayPathService(repo, logs).logList();
    expect(logs.list).toHaveBeenCalledWith(100);
    expect(out).toEqual([{ event: 'created', actor: 'u1' }]);
  });

  it('searchRoutes delegates a paginated query to repo.search (no in-service scanning)', async () => {
    const result = { page: 2, limit: 5, total: 1, data: [{ name: 'get-booking' }] };
    const repo = mkRepo({ search: jest.fn(async () => result) });
    const out = await new GatewayPathService(repo, mkLogs()).searchRoutes('booking', 2, 5);
    expect(repo.search).toHaveBeenCalledWith('booking', 2, 5);
    expect(out).toBe(result);
  });

  it('logSearch delegates a filtered+paginated query to the journal repo', async () => {
    const result = { page: 1, limit: 20, total: 0, data: [] };
    const logs = mkLogs();
    logs.query = jest.fn(async () => result);
    const out = await new GatewayPathService(mkRepo(), logs).logSearch('u1', undefined, 'updated', undefined, undefined, undefined, 1, 20);
    expect(logs.query).toHaveBeenCalledWith({ actor: 'u1', service: undefined, event: 'updated', routeKey: undefined, from: undefined, to: undefined }, 1, 20);
    expect(out).toBe(result);
  });
});
