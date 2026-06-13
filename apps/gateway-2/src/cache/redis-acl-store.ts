import { Injectable } from '@nestjs/common';
import { AclCacheStore } from '@open-rlb/nestjs-amqp';
import { InjectRedisConnection } from '@rlb-core/lib-nestjs-redis';
import { RedisClientType } from 'redis';

export const ACL_REDIS_NAMESPACE = 'acl';

/** L2 ACL cache backed by Redis (node-redis). Stores '1'/'0' decisions with EX TTL. */
@Injectable()
export class RedisAclStore implements AclCacheStore {
  constructor(@InjectRedisConnection(ACL_REDIS_NAMESPACE) private readonly client: RedisClientType) { }

  async get(key: string): Promise<string | null | undefined> {
    const value = await this.client.get(key);
    return value as string | null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }
}
