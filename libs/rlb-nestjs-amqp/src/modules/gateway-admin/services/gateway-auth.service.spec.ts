import { GatewayAuthService } from './gateway-auth.service';

const mkPaths = (routes: any[]) => ({
  filter: jest.fn().mockResolvedValue(routes),
  updateById: jest.fn().mockResolvedValue({}),
});
const mkRepo = () => ({ removeByName: jest.fn().mockResolvedValue({ name: 'p' }) });

describe('GatewayAuthService.remove — referential integrity', () => {
  it('deletes when no route references the provider', async () => {
    const repo = mkRepo();
    const paths = mkPaths([]);
    await new GatewayAuthService(repo as any, paths as any).remove('p');
    expect(repo.removeByName).toHaveBeenCalledWith('p');
    expect(paths.updateById).not.toHaveBeenCalled();
  });

  it('throws 409 ConflictError with the conflicting routes when referenced and not forced', async () => {
    const routes = [{ _id: '1', routeKey: 'GET /a', method: 'GET', path: '/a', name: 'ra', auth: 'p' }];
    const repo = mkRepo();
    const paths = mkPaths(routes);
    await expect(new GatewayAuthService(repo as any, paths as any).remove('p')).rejects.toMatchObject({
      name: 'ConflictError',
      details: { routes: [{ routeKey: 'GET /a', method: 'GET', path: '/a', name: 'ra' }] },
    });
    expect(repo.removeByName).not.toHaveBeenCalled();
    expect(paths.updateById).not.toHaveBeenCalled();
  });

  it('force=true clears `auth` on each route, then deletes', async () => {
    const routes = [{ _id: '1', routeKey: 'GET /a', auth: 'p' }, { _id: '2', routeKey: 'POST /b', auth: 'p' }];
    const repo = mkRepo();
    const paths = mkPaths(routes);
    await new GatewayAuthService(repo as any, paths as any).remove('p', true);
    expect(paths.updateById).toHaveBeenCalledTimes(2);
    expect(paths.updateById).toHaveBeenCalledWith('1', { auth: null });
    expect(repo.removeByName).toHaveBeenCalledWith('p');
  });

  it('accepts force as the string "true"', async () => {
    const repo = mkRepo();
    const paths = mkPaths([{ _id: '1', auth: 'p' }]);
    await new GatewayAuthService(repo as any, paths as any).remove('p', 'true');
    expect(repo.removeByName).toHaveBeenCalled();
  });
});
