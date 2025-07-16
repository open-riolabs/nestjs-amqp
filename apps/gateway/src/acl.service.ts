import { Injectable, Logger } from '@nestjs/common';
import { BrokerService } from '@sicilyaction/lib-nestjs-amqp';
import { IAclRoleService } from '@sicilyaction/lib-nestjs-amqp/modules/proxy/services/acl.service';

@Injectable()
export class AclService implements IAclRoleService {

  private readonly logger: Logger = new Logger(AclService.name);

  constructor(private readonly brokerService: BrokerService) { }

  async canUserDo(topic: string, action: string, userId: string): Promise<boolean> {
    try {
      return await this.brokerService.requestData<any, boolean>(topic, action, { userId });
    }
    catch (e) {
      this.logger.error(e);
      return false;
    }
  }
}