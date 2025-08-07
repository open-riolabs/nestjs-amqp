export interface PathDefinition {
  name: string;
  method: string;
  path: string;
  parseRaw?: boolean;
  topic: string;
  action: string;
  dataSource: 'body' | 'query' | 'params' | 'body-query' | 'query-body';
  mode: 'event' | 'rpc';
  auth?: string;
  allowAnonymous?: boolean;
  roles: string[];
  timeout?: number;
  headers: {
    [k: string]: string | string[] | number;
  };
  forwardHeaders: {
    [k: string]: string;
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
  headers?: { [k: string]: string | string[] | number; };
  timeout?: number;
}

export interface GatewayConfigLoader {
  paths?: GatewayConfigSource,
  events?: GatewayConfigSource,
}

export interface GatewayConfigSource {
  topic: string,
  action: string,
  tags?: string[];
}

export interface GatewayConfig {
  headerPrefix?: string;
  loadConfig?: GatewayConfigLoader;
  paths: PathDefinition[];
  events: WebSocketEvent[];
}