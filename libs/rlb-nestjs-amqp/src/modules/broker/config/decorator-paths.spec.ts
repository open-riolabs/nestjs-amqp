import { buildPathDefinitionsFromMeta, pairAuthToRoutes } from './decorator-paths';

describe('buildPathDefinitionsFromMeta', () => {
  it('emits one route per @BrokerHTTP, reading the per-route auth resolved onto each route', () => {
    const meta = {
      orders: {
        'order.create': { type: 'rpc', http: [{ method: 'POST', path: '/orders', dataSource: 'body', auth: 'w', actions: ['orders.write'] }] },
        'order.quote': { type: 'rpc', http: [{ method: 'GET', path: '/orders/quote', dataSource: 'query', auth: 'r', allowAnonymous: true }] },
      },
    };
    const defs = buildPathDefinitionsFromMeta(meta);
    expect(defs).toHaveLength(2);
    expect(defs.find(d => d.method === 'POST')).toMatchObject({ topic: 'orders', action: 'order.create', auth: 'w', actions: ['orders.write'], mode: 'rpc' });
    expect(defs.find(d => d.method === 'GET')).toMatchObject({ topic: 'orders', action: 'order.quote', auth: 'r', allowAnonymous: true, mode: 'rpc' });
  });

  it('passes through the full dataSource set, incl. body-query / query-body', () => {
    const meta = { t: { a: { type: 'rpc', http: [
      { method: 'POST', path: '/bq', dataSource: 'body-query' },
      { method: 'GET', path: '/qb', dataSource: 'query-body' },
    ] } } };
    const defs = buildPathDefinitionsFromMeta(meta);
    expect(defs.map((d) => d.dataSource).sort()).toEqual(['body-query', 'query-body']);
  });

  it('returns [] for empty meta and defaults mode from the @BrokerAction type', () => {
    expect(buildPathDefinitionsFromMeta({})).toEqual([]);
    const defs = buildPathDefinitionsFromMeta({ t: { a: { type: 'event', auth: [], http: [{ method: 'POST', path: '/x', dataSource: 'body' }] } } });
    expect(defs[0]).toMatchObject({ mode: 'event', name: 't:a:POST:/x' });
  });
});

describe('pairAuthToRoutes (per-route auth pairing)', () => {
  it('single @BrokerHTTP + @BrokerAuth auto-pairs (no httpName needed)', () => {
    const h: any[] = [{ method: 'GET', path: '/x', dataSource: 'query' }];
    const w = pairAuthToRoutes(h, [{ authName: 'jwks-a', allowAnonymous: true }], 'Svc.m');
    expect(h[0]).toMatchObject({ auth: 'jwks-a', allowAnonymous: true });
    expect(w).toHaveLength(0);
  });

  it('multiple @BrokerHTTP pair by httpName === route name', () => {
    const h: any[] = [
      { method: 'GET', path: '/b/:id', name: 'cust', dataSource: 'params' },
      { method: 'GET', path: '/admin/b/:id', name: 'adm', dataSource: 'params' },
    ];
    const w = pairAuthToRoutes(h, [
      { authName: 'cust-jwks', allowAnonymous: true, httpName: 'cust' },
      { authName: 'admin-jwks', actions: ['admin'], httpName: 'adm' },
    ], 'Svc.m');
    expect(h[0].auth).toBe('cust-jwks');
    expect(h[1].auth).toBe('admin-jwks');
    expect(h[1].actions).toEqual(['admin']);
    expect(w).toHaveLength(0);

    const routes = buildPathDefinitionsFromMeta({ booking: { 'get-booking': { type: 'rpc', http: h } } });
    expect(routes.find((r: any) => r.path === '/b/:id').auth).toBe('cust-jwks');
    expect(routes.find((r: any) => r.path === '/admin/b/:id').auth).toBe('admin-jwks');
  });

  it('multiple @BrokerHTTP with an auth missing httpName → warning + not applied', () => {
    const h: any[] = [
      { method: 'GET', path: '/p1', name: 'one', dataSource: 'query' },
      { method: 'GET', path: '/p2', name: 'two', dataSource: 'query' },
    ];
    const w = pairAuthToRoutes(h, [{ authName: 'orphan', allowAnonymous: true }], 'Svc.m');
    expect(h[0].auth).toBeUndefined();
    expect(h[1].auth).toBeUndefined();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("no 'httpName'");
  });

  it('a route with no paired auth stays public', () => {
    const h: any[] = [
      { method: 'GET', path: '/pub', name: 'p', dataSource: 'query' },
      { method: 'GET', path: '/sec', name: 's', dataSource: 'query' },
    ];
    pairAuthToRoutes(h, [{ authName: 'sec-jwks', httpName: 's' }], 'Svc.m');
    expect(h[0].auth).toBeUndefined();
    expect(h[1].auth).toBe('sec-jwks');
  });
});
