import { RLB_BROKER_METHOD_METADATA_KEY, RLB_BROKER_PARAM_METADATA_KEY } from "../const";

const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
const ARGUMENT_NAMES = /([^\s,]+)/g;
export type BrokerParamSource = 'body' | 'body-full' | 'header' | 'tag';

export function BrokerAction(topic: string, action: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_METHOD_METADATA_KEY, target.constructor) || [];
    const params = getParamNames(descriptor.value);
    existingMetadata.push({
      methodName: propertyKey,
      topic,
      action,
      params
    });
    Reflect.defineMetadata(RLB_BROKER_METHOD_METADATA_KEY, existingMetadata, target.constructor);
  };
}

export function BrokerParam(source: BrokerParamSource, name?: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const existingMetadata = Reflect.getMetadata(RLB_BROKER_PARAM_METADATA_KEY, target, propertyKey) || [];

    existingMetadata.push({ index: parameterIndex, name, source });

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