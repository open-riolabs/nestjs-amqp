import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerAuth, BrokerHTTP, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class ActionService {

  // --- Example 1: single @BrokerAction + single @BrokerHTTP -----------------
  // One action on the method: @BrokerHTTP needs no `action` — it binds to the
  // only one by default.
  @BrokerAction('test-local', 'test-01', 'rpc')
  @BrokerAuth('rlb-gateway', true, ['admin'])
  @BrokerHTTP('POST', '/demo/pippo', 'body', {
    binary: true,
    redirect: 301,
    parseRaw: true,
    timeout: 20000,
    successStatusCode: 200,
  })
  pippo(
    @BrokerParam("header", "X-GTW-AUTH-USERID") userId: string,
    @BrokerParam("body", "parametro") par2: string,
    par3: string) {
    console.log(userId, par2, par3);
    return "ok";
  }

  // --- Example 2: ONE method, TWO actions, per-action auth + routes ---------
  // The method handles two distinct (topic, action) pairs. Both @BrokerAuth and
  // @BrokerHTTP name their target `action`, so each pairing is deterministic
  // (decorator order is NOT used):
  //   order.create -> auth 'orders-write' (role orders.write) + POST /orders
  //   order.quote  -> auth 'orders-read'  (public)            + GET  /orders/quote
  @BrokerAction('orders', 'order.create', 'rpc')
  @BrokerAction('orders', 'order.quote', 'rpc')
  @BrokerAuth('orders-write', false, ['orders.write'], 'order.create')
  @BrokerAuth('orders-read', true, [], 'order.quote')
  @BrokerHTTP('POST', '/orders', 'body', { action: 'order.create' })
  @BrokerHTTP('GET', '/orders/quote', 'query', { action: 'order.quote', successStatusCode: 200 })
  orders(
    @BrokerParam("action") action: string,
    @BrokerParam("body-full") payload: any) {
    console.log(action, payload);
    return { action, payload };
  }
}
