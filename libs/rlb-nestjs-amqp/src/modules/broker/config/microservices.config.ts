export interface MicroserviceConfig {
  topics: BrokerTopic[];
}

/**
 * Represents the configuration for a microservice topic.
 */
export interface BrokerTopic {
  
  /**
   * The name of the high-level topic (Microservice)
   */
  name: string;

  /**
   * Indicates if the topic is for RPC (Remote Procedure Call).
   * @default false
   */
  rpc?: boolean;

  /**
   * Indicates if the topic should be handled (AKC management)
   * @default false
   */
  handle?: boolean;

  /**
   * The name of the queue associated with the topic. (RPC/Handle, exchange direct)
   */
  queue: string;

  /**
   * The routing key for the topic. Topic mode (Exchange topic)
   */
  routingKey?: string;

  /**
   * The exchange associated with the  routing key (Exchange topic)
   */
  exchange?: string;
}