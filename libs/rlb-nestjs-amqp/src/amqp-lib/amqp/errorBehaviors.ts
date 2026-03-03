import { Channel } from 'amqplib';
import { QueueOptions } from '../config/rabbitmq-queue.config';
import { LegacyMessageErrorHandler, MessageHandlerErrorBehavior } from '../types';

/**
 * An error handler that will ack the message which caused an error during processing
 */
export function ackErrorHandler(channel: Channel, msg: any) {
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    channel.ack(m);
  }
}

/**
 * An error handler that will nack and requeue a message which created an error during processing
 */
export function requeueErrorHandler(channel: Channel, msg: any) {
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    channel.nack(m, false, true);
  }
}

/**
 * An error handler that will nack a message which created an error during processing
 */
export function defaultNackErrorHandler(channel: Channel, msg: any) {
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    channel.nack(m, false, false);
  }
}

export function getHandlerForLegacyBehavior(behavior: MessageHandlerErrorBehavior): LegacyMessageErrorHandler {
  switch (behavior) {
    case MessageHandlerErrorBehavior.ACK:
      return ackErrorHandler;
    case MessageHandlerErrorBehavior.REQUEUE:
      return requeueErrorHandler;
    default:
      return defaultNackErrorHandler;
  }
}

/**
 * Just rethrows the error
 */
export function defaultAssertQueueErrorHandler(channel: Channel, queueName: string, queueOptions: QueueOptions | undefined, error: any): Promise<string> | string {
  throw error;
};

/**
 * Tries to delete the queue and to redeclare it with the provided options
 */
export async function forceDeleteAssertQueueErrorHandler(channel: Channel, queueName: string, queueOptions: QueueOptions | undefined, error: any) {
  if (error.code == 406) {
    await channel.deleteQueue(queueName);
    const { queue } = await channel.assertQueue(queueName, queueOptions);
    return queue;
  }
  throw error;
}