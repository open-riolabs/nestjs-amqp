import { buildPathDefinitionsFromMeta } from './decorator-paths';

describe('buildPathDefinitionsFromMeta', () => {
  it('emits one route per @BrokerHTTP, with auth flattened per action', () => {
    const meta = {
      orders: {
        'order.create': { type: 'rpc', auth: [{ authName: 'w', allowAnonymous: false, roles: ['orders.write'], action: 'order.create' }], http: [{ method: 'POST', path: '/orders', dataSource: 'body', action: 'order.create' }] },
        'order.quote': { type: 'rpc', auth: [{ authName: 'r', allowAnonymous: true, roles: [], action: 'order.quote' }], http: [{ method: 'GET', path: '/orders/quote', dataSource: 'query', action: 'order.quote' }] },
      },
    };
    const defs = buildPathDefinitionsFromMeta(meta);
    expect(defs).toHaveLength(2);
    expect(defs.find(d => d.method === 'POST')).toMatchObject({ topic: 'orders', action: 'order.create', auth: 'w', roles: ['orders.write'], mode: 'rpc' });
    expect(defs.find(d => d.method === 'GET')).toMatchObject({ topic: 'orders', action: 'order.quote', auth: 'r', allowAnonymous: true, mode: 'rpc' });
  });

  it('returns [] for empty meta and defaults mode from the @BrokerAction type', () => {
    expect(buildPathDefinitionsFromMeta({})).toEqual([]);
    const defs = buildPathDefinitionsFromMeta({ t: { a: { type: 'event', auth: [], http: [{ method: 'POST', path: '/x', dataSource: 'body' }] } } });
    expect(defs[0]).toMatchObject({ mode: 'event', name: 't:a:POST:/x' });
  });
});
