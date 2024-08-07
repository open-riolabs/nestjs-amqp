import { Observable } from "rxjs";

export interface BrokerEvent<Payload = any> {
  topic: string;
  payload: Payload;
  source: {
    exchange: string;
    routingKey: string;
    tag: string;
  }
  headers: { [key: string]: any };
  raw: Buffer;
}

export type BrokerEventHandler<Payload = any, Response = any> = (event: BrokerEvent<Payload>) => Response | Promise<Response> | Observable<Response>;