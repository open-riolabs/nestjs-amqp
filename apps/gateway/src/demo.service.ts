import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@sicilyaction/lib-nestjs-amqp';
import { NotFoundError } from '@sicilyaction/lib-nestjs-core';


@Injectable()
export class DemoService {

    @BrokerAction('local-test', 'test-01')
    async pippo(
        @BrokerParam("header", "X-GTW-AUTH-USERID") userId: string,
        @BrokerParam("body", "parametro") par2: string,
        @BrokerParam("body-full") pard2: string,
        par3: string) {
        console.log("UserId:", userId);
        await new Promise(resolve => setTimeout(resolve, 15000));
        //throw new Error("This is a test error");
        // return "ok";
    }


    @BrokerAction('local-test', 'test-02')
    async filterUsers(
        @BrokerParam('body-full') query: any,
        @BrokerParam('body', 'page') page: number = 1,
        @BrokerParam('body', 'limit') limit: number = 10,
    ): Promise<any> {
        try {
            console.log(query, page, limit);
            return;
        } catch (error) {
            throw error;
        }
    }
}
