import { PipeTransform } from "@nestjs/common";
import { RLB_BROKER_AUTH_METADATA_KEY, RLB_BROKER_HTTP_METADATA_KEY, RLB_BROKER_METHOD_METADATA_KEY, RLB_BROKER_PARAM_METADATA_KEY } from "../const";

const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
const ARGUMENT_NAMES = /([^\s,]+)/g;
export type BrokerParamSource = 'body' | 'body-full' | 'header' | 'tag' | 'action' | 'topic';
export type BrokerActionType = 'rpc' | 'event';
export type BrokerHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type BrokerHttpDataSource = 'query' | 'body' | 'params';

export function BrokerAction(topic: string, action: string, type?: BrokerActionType): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_METHOD_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      topic,
      action,
      type,
      params
    });
    Reflect.defineMetadata(RLB_BROKER_METHOD_METADATA_KEY, existingMetadata, target.constructor);
  };
}

export function BrokerHTTP(
  method: BrokerHttpMethod, path: string, dataSource: BrokerHttpDataSource, options?: {
    /** Binds this route to a specific @BrokerAction on the same method, by action name.
     *  Required when the method declares more than one @BrokerAction; with a single action
     *  it defaults to that action. Makes the http↔action pairing deterministic (decorator
     *  order/position is NOT used). */
    action?: string,
    /** Optional route name. Auth stays decoupled in @BrokerAuth, which targets THIS route by its
     *  `name` (see @BrokerAuth's `httpName`). Needed only when the method declares more than one
     *  @BrokerHTTP; with a single @BrokerHTTP the auth auto-pairs and no name is required. */
    name?: string,
    successStatusCode?: number,
    timeout?: number,
    parseRaw?: boolean;
    binary?: boolean,
    redirect?: number,
    headers?: { [k: string]: string | number | boolean; },
    forwardHeaders?: { [k: string]: string | number | boolean; },
  }
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_HTTP_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      method,
      path,
      dataSource,
      ...(options || {})
    });
    Reflect.defineMetadata(RLB_BROKER_HTTP_METADATA_KEY, existingMetadata, target.constructor);
  };
}

// Per-ROUTE auth, kept DECOUPLED from @BrokerHTTP. It pairs to a specific @BrokerHTTP route by the
// route's `httpName` (= the `name` given in that @BrokerHTTP's options):
//  - a method with ONE @BrokerHTTP auto-pairs (httpName optional — the simple case);
//  - a method with MULTIPLE @BrokerHTTP REQUIRES `httpName` to disambiguate; an auth whose httpName
//    is missing or matches no route is NOT applied and logs a warning at microservice startup.
export function BrokerAuth(authName: string, allowAnonymous?: boolean, roles?: string[], httpName?: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_AUTH_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      authName,
      allowAnonymous,
      roles,
      httpName,
    });
    Reflect.defineMetadata(RLB_BROKER_AUTH_METADATA_KEY, existingMetadata, target.constructor);
  };
}
export function BrokerParam(source: BrokerParamSource, name?: string, pipe?: PipeTransform): ParameterDecorator {

  return (target, propertyKey, parameterIndex) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_PARAM_METADATA_KEY, target, propertyKey) || [];

    existingMetadata.push({ index: parameterIndex, name, source, pipe });

    Reflect.defineMetadata(RLB_BROKER_PARAM_METADATA_KEY, existingMetadata, target, propertyKey);
  };
}

function getParamNames(func) {
  var fnStr = func.toString().replace(STRIP_COMMENTS, '');
  var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
  if (result === null)
    result = [];
  return result;
}