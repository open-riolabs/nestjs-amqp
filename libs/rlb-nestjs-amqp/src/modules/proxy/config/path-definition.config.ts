export interface PathDefinition {
  name: string;
  method: string;
  path: string;
  topic: string;
  action: string;
  dataSource: 'body' | 'query' | 'params';
  mode: 'event' | 'rpc';
  auth?: string;
  allowAnonymous?: boolean;
  roles: {
    all: string[];
    some: string[];
  };
  headers: {
    [k: string]: string | string[] | number;
  };
  forwardHeaders: {
    [k: string]: string
  };
  redirect: number;
}

export interface WebSocketEvent {
  type: 'ws' | 'mqtt' | 'http';
  exchange: string;
  routingKey: string;
  name: string;
  auth?: string;
  roles?: [];
  url?: string;
  method?: string;
  headers?: { [k: string]: string | string[] | number; }
}

export interface GatewayConfig {
  headerPrefix?: string;
  paths: PathDefinition[];
  events: WebSocketEvent[];
}