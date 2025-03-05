import { Observable } from "rxjs";

export interface BrokerEvent<Payload = any> {
  topic: string;
  payload: Payload;
  action: string;
  source: {
    exchange: string;
    routingKey: string;
    tag: string;
  };
  headers: { [key: string]: any; };
  raw: Buffer;
}

export type RpcEvent<Payload = any> = { action: string; payload: Payload; };
export type TopicEventHandler<Payload = any> = (event: BrokerEvent<Payload>) => void | Promise<void> | Observable<void>;
export type BrokerEventHandler<Payload = any, Response = any> = (event: BrokerEvent<Payload>) => Response | Promise<Response> | Observable<Response>;
export type RpcEventHandler<Payload = any, Response = any> = (event: BrokerEvent<RpcEvent<Payload>>) => Response | Promise<Response> | Observable<Response>;
export type MangedFunctionExecutor<Payload = any> = { success: boolean, payload?: Payload, error?: { name: string, message: string; }; };