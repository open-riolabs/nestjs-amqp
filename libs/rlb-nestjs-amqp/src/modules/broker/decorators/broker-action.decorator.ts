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

export function BrokerHTTP(method: BrokerHttpMethod, path: string, dataSource?: BrokerHttpDataSource, timeout?: number, parseRaw?: boolean): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_HTTP_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      method,
      path,
      dataSource,
      parseRaw,
      timeout,
    });
    Reflect.defineMetadata(RLB_BROKER_HTTP_METADATA_KEY, existingMetadata, target.constructor);
  };
}

export function BrokerAuth(authName: string, allowAnonymous?: boolean, roles?: string[]): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_AUTH_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      authName,
      allowAnonymous,
      roles,
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