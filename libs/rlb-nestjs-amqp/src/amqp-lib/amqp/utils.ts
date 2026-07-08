import { Options } from 'amqplib';
import { RabbitMQUriConfig } from '../types';

export function matchesRoutingKey(routingKey: string, pattern: string[] | string | undefined): boolean {
  // An empty string is a valid pattern therefore
  // we should only exclude null values and empty array
  if (pattern === undefined || (Array.isArray(pattern) && pattern.length === 0))
    return false;

  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  for (const p of patterns) {
    if (routingKey === p) return true;
    const splitKey = routingKey.split('.');
    const splitPattern = p.split('.');
    let starFailed = false;
    for (let i = 0; i < splitPattern.length; i++) {
      if (splitPattern[i] === '#') return true;

      if (splitPattern[i] !== '*' && splitPattern[i] !== splitKey[i]) {
        starFailed = true;
        break;
      }
    }

    if (!starFailed && splitKey.length === splitPattern.length) return true;
  }

  return false;
}

export function validateRabbitMqUris(uri: string): void {
  const rmqUri = new URL(uri);
  if (!rmqUri.protocol.startsWith('amqp')) {
    throw new Error('RabbitMQ URI protocol must start with amqp or amqps');
  }
};

export function converUriConfigObjectsToUris(uri: RabbitMQUriConfig): string {
  if (typeof uri == 'string') return uri;
  return amqplibUriConfigToUrl(uri);
};

export function isObject(value: any): boolean {
  return value !== null && typeof value === 'object';
}

export function isPlainObject(value: any): boolean {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function merge<T = any>(target: T, ...sources: Partial<T>[]): T {
  if (!isObject(target)) {
    throw new TypeError('Target must be an object');
  }

  for (const source of sources) {
    if (!isObject(source)) continue;

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      // Skip undefined (lodash behavior)
      if (sourceValue === undefined) continue;

      // Array handling (merge per index)
      if (Array.isArray(sourceValue)) {
        if (Array.isArray(targetValue)) {
          for (let i = 0; i < sourceValue.length; i++) {
            if (isPlainObject(sourceValue[i]) || Array.isArray(sourceValue[i])) {
              targetValue[i] = merge(
                Array.isArray(sourceValue[i]) ? [] : {},
                targetValue[i],
                sourceValue[i]
              );
            } else {
              targetValue[i] = sourceValue[i];
            }
          }
        } else {
          target[key] = merge([], sourceValue);
        }
        continue;
      }

      // Plain object handling
      if (isPlainObject(sourceValue)) {
        if (isPlainObject(targetValue)) {
          merge(targetValue, sourceValue);
        } else {
          target[key] = merge({}, sourceValue);
        }
        continue;
      }

      // Primitive / Date / Map / etc → overwrite
      target[key] = sourceValue;
    }
  }

  return target;
}

const amqplibUriConfigToUrl = ({
  hostname,
  username,
  password,
  frameMax,
  heartbeat,
  vhost,
  protocol = 'amqp',
  port = 5672,
}: Options.Connect): string => {
  if (!hostname) {
    throw new Error("Configuration object must contain a 'hostname' key.");
  }

  const auth =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';

  const params = new URLSearchParams();
  if (frameMax) params.set('frameMax', frameMax.toString());
  if (heartbeat) params.set('heartbeat', heartbeat.toString());

  return `${protocol}://${auth}${hostname}:${port}${vhost ?? ''}${params.size == 0 ? '' : `?${params.toString()}`}`;
};