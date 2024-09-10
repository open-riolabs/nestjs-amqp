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

export type RpcEvent<Payload = any> = { action: string; payload: Payload; }
export type BrokerEventHandler<Payload = any, Response = any> = (event: BrokerEvent<Payload>) => Response | Promise<Response> | Observable<Response>;
export type RpcEventHandler<Payload = any, Response = any> = (event: BrokerEvent<RpcEvent<Payload>>) => Response | Promise<Response> | Observable<Response>;
export type MangedFunctionExecutor<Payload = any> = { success: boolean, payload?: Payload, error?: Error };