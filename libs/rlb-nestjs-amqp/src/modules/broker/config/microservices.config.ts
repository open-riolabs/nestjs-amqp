export interface MicroserviceConfig {
  topics: BrokerTopic[];
}

export interface BrokerTopic {
  name: string;
  queue: string;
  handle?: boolean;
  rpc: boolean;
}