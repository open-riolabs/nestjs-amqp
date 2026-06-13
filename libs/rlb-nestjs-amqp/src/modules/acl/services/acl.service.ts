import { Injectable, Logger } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '../../broker';
import { IAclRoleService } from '../../proxy/services/acl.service';
import { AclCacheService } from '../cache/acl-cache.service';
import { ACL_ACTIONS, ACL_TOPIC } from '../const';
import { AclGrantRepository } from '../repository/acl-grant.repository';

@Injectable()
export class AclService implements IAclRoleService {
  private readonly logger = new Logger(AclService.name);

  constructor(
    private readonly grants: AclGrantRepository,
    private readonly cache: AclCacheService,
  ) { }

  /**
   * IAclRoleService entrypoint. `action` is the permission to check; `topic` is used
   * as a cache namespace. Decision is served from the 2-tier cache and only hits the
   * DB on a miss.
   */
  async canUserDo(topic: string, action: string, userId: string): Promise<boolean> {
    if (!userId || !action) return false;
    const cached = await this.cache.get(userId, topic, action);
    if (cached !== null) return cached;
    const allowed = await this.grants.checkActions({ userId }, action);
    await this.cache.set(userId, topic, action, allowed);
    return allowed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.canUserDo, 'rpc')
  async handleCanUserDo(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'action') action: string,
    @BrokerParam('body', 'topic') topic?: string,
  ): Promise<boolean> {
    try {
      return await this.canUserDo(topic ?? ACL_TOPIC, action, userId);
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }
}
