import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerHTTP, BrokerParam } from '@open-rlb/nestjs-amqp';

/**
 * Calculator operations exposed BOTH ways from a single method:
 *  - `@BrokerAction("calculator", "<op>")` makes the method an AMQP RPC handler bound to the
 *    `calculator` topic (see config/config.yaml → topics), dispatched by the `<op>` action name.
 *  - `@BrokerHTTP("POST", "/calculator/<op>", "body")` is the route metadata a gateway discovers
 *    (route auto-discovery) and publishes as an HTTP endpoint that forwards to the same handler.
 *
 * `@BrokerParam("body", "values")` extracts a single field out of the RPC/HTTP payload — handlers
 * take FLAT parameters (no object destructuring), one decorator per argument.
 */
@Injectable()
export class AppService {

  /** Sum of all values. Seeded with 0, so an empty array returns 0. */
  @BrokerAction("calculator", "sum")
  @BrokerHTTP("POST", "/calculator/sum", "body")
  async sum(
    @BrokerParam("body", "values") values: number[]) {
    return values.reduce((acc, value) => acc + value, 0);
  }

  /** Left-to-right subtraction (no seed → the first element is the starting accumulator). */
  @BrokerAction("calculator", "sub")
  @BrokerHTTP("POST", "/calculator/sub", "body")
  async sub(
    @BrokerParam("body", "values") values: number[]) {
    return values.reduce((acc, value) => acc - value);
  }

  /** Product of all values. Seeded with 1, so an empty array returns 1. */
  @BrokerAction("calculator", "mul")
  @BrokerHTTP("POST", "/calculator/mul", "body")
  async mul(
    @BrokerParam("body", "values") values: number[]) {
    return values.reduce((acc, value) => acc * value, 1);
  }

  /** Left-to-right division (no seed → the first element is the numerator). */
  @BrokerAction("calculator", "div")
  @BrokerHTTP("POST", "/calculator/div", "body")
  async div(
    @BrokerParam("body", "values") values: number[]) {
    return values.reduce((acc, value) => acc / value);
  }

  /** Square root of a single `value` field. */
  @BrokerAction("calculator", "sqrt")
  @BrokerHTTP("POST", "/calculator/sqrt", "body")
  async sqrt(
    @BrokerParam("body", "value") value: number) {
    return Math.sqrt(value);
  }

}
