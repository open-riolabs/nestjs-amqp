import { Channel, ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import { QueueOptions } from "./config/rabbitmq-queue.config";
import { RabbitMQChannelConfig } from "./config/rabbitmq.config";
import { Nack } from "./models/nack.model";
import { MessageHandlerOptions } from "./models/rabbitmq-handler.model";

export type ConsumeOptions = Options.Consume;
export type MessageDeserializer = (message: Buffer, msg: ConsumeMessage) => any;
export type MessageSerializer = (value: any) => Buffer;
export type RabbitMQChannels = Record<string, RabbitMQChannelConfig>;
export type RabbitMQHandlers = Record<string, MessageHandlerOptions | MessageHandlerOptions[]>;
export type RabbitMQUriConfig = Options.Connect | string;
export enum MessageHandlerErrorBehavior { ACK = 'ACK', NACK = 'NACK', REQUEUE = 'REQUEUE', }

type BaseMessageErrorHandler<T extends ConsumeMessage | ConsumeMessage[]> = (
  channel: Channel,
  msg: T,
  error: any
) => Promise<void> | void;

export type MessageErrorHandler = BaseMessageErrorHandler<ConsumeMessage>;

export type BatchMessageErrorHandler = BaseMessageErrorHandler<
  ConsumeMessage[]
>;

export type LegacyMessageErrorHandler = BaseMessageErrorHandler<
  ConsumeMessage | ConsumeMessage[]
>;

export type RpcResponse<T> = T | Nack;
export type SubscribeResponse = Nack | undefined | void;
export const DIRECT_REPLY_QUEUE = 'amq.rabbitmq.reply-to'; // This is a special queue name that RabbitMQ uses for direct reply-to functionality

export type ConsumerTag = string;

export type SubscriberHandler<T = unknown> = (
  msg: T | undefined,
  rawMessage?: ConsumeMessage,
  headers?: any,
) => Promise<SubscribeResponse>;

export type BatchSubscriberHandler<T = unknown> = (
  msg: (T | undefined)[],
  rawMessage?: ConsumeMessage[],
  headers?: any[],
) => Promise<SubscribeResponse>;

export type RpcSubscriberHandler<T = unknown, U = unknown> = (
  msg: T | undefined,
  rawMessage?: ConsumeMessage,
  headers?: any,
) => Promise<RpcResponse<U>>;
export type BaseConsumerHandler = {
  consumerTag: string;
  channel: ConfirmChannel;
  msgOptions: MessageHandlerOptions;
};

export type ConsumerHandler<T, U> =
  | (BaseConsumerHandler & {
    type: 'subscribe';
    handler: SubscriberHandler<T>;
  })
  | (BaseConsumerHandler & {
    type: 'subscribe-batch';
    handler: BatchSubscriberHandler<T>;
  })
  | (BaseConsumerHandler & {
    type: 'rpc';
    handler: RpcSubscriberHandler<T, U>;
  });

export type Consumer = (msg: ConsumeMessage | null) => void | Promise<void>;
export type AssertQueueErrorHandler = (channel: Channel, queueName: string, queueOptions: QueueOptions | undefined, error: any) => Promise<string> | string;
