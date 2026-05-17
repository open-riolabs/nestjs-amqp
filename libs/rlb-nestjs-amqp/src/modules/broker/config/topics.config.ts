import { MessageHandlerErrorBehavior } from '../../../amqp-lib/types';

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
  mode: 'rpc' | 'event' | 'broadcast' | 'handle';

  /**
   * Indicates if the topic should be converted to an observable.
   * @default false
   */
  toObservable?: boolean;

  /**
   * The name of the queue associated with the topic. (RPC/Handle, exchange direct)
   */
  queue?: string;

  /**
   * The routing key for the topic. Topic mode (Exchange topic)
   */
  routingKey?: string;

  /**
   * The exchange associated with the  routing key (Exchange topic)
   */
  exchange?: string;

  /**
   * Error behavior when message processing fails at the connection level.
   * Applies to the decorator-based path (@BrokerAction via MetadataScanner).
   * @default MessageHandlerErrorBehavior.REQUEUE
   */
  errorBehavior?: MessageHandlerErrorBehavior;

  /**
   * Publish with the AMQP `mandatory` flag. When true, messages that cannot be
   * routed to any queue are returned to the publisher and surface on the
   * channel `return` handler (logged by AmqpConnection). Applies to publish
   * for `event`/`broadcast` and to the request publish for `rpc`.
   * @default false
   */
  mandatory?: boolean;

  /**
   * Publish with the AMQP `persistent` flag (delivery-mode 2). When true, the
   * broker writes the message to disk so it survives a broker restart -
   * provided the target queue is also `durable: true`. Applies to publish for
   * `event`/`broadcast` and to the request publish for `rpc`. The RPC reply
   * persistence is controlled separately via `usePersistentReplyTo` on the
   * handler options.
   * @default false
   */
  persistent?: boolean;
}