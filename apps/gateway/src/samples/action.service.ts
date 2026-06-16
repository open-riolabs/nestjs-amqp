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

  // --- Example 2: ONE method, TWO actions, TWO routes bound by name ---------
  // The method handles two distinct (topic, action) pairs. Each @BrokerHTTP
  // names its target `action`, so the http<->action pairing is deterministic
  // (decorator order is NOT used): POST /orders -> order.create,
  // GET /orders/quote -> order.quote.
  @BrokerAction('orders', 'order.create', 'rpc')
  @BrokerAction('orders', 'order.quote', 'rpc')
  @BrokerHTTP('POST', '/orders', 'body', { action: 'order.create' })
  @BrokerHTTP('GET', '/orders/quote', 'query', { action: 'order.quote', successStatusCode: 200 })
  orders(
    @BrokerParam("action") action: string,
    @BrokerParam("body-full") payload: any) {
    console.log(action, payload);
    return { action, payload };
  }
}
