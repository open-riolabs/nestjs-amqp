import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@sicilyaction/lib-nestjs-amqp';

@Injectable()
export class Demo2Service {

    @BrokerAction('local-test', 'test-02')
    pippo(
        @BrokerParam("header", "X-GTW-AUTH-USERID") userId: string,
        @BrokerParam("body", "parametro") par2: string,
        par3: string) {
        console.log(userId, par2, par3);
        return "ok";
    }


    // @BrokerAction('rlb-admin', 'user-acl-list-2')
    // async filterUsers(
    //     @BrokerParam('body-full') query: any,
    //     @BrokerParam('body', 'page') page: number = 1,
    //     @BrokerParam('body', 'limit') limit: number = 10,
    // ): Promise<any> {
    //     try {
    //         console.log(query, page, limit);
    //         return;
    //     } catch (error) {
    //         throw error;
    //     }
    // }
}

