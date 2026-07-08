/**
 * Custom error thrown when an RPC request times out waiting for a response.
 */
export class RpcTimeoutError extends Error {
  constructor(
    public readonly timeout: number,
    public readonly exchange: string,
    public readonly routingKey: string,
  ) {
    super(
      `Failed to receive response within timeout of ${timeout}ms for exchange "${exchange}" and routing key "${routingKey}"`,
    );
    this.name = 'RpcTimeoutError';
  }
}

/**
 * Thrown when an incoming message body cannot be deserialized (e.g. non-JSON
 * content with the default deserializer). Marked as NOT retriable by the retry
 * policy: the message can never become valid, so it goes straight to the
 * dead-letter/drop path instead of hot-looping the consumer.
 */
export class MessageDeserializationError extends Error {
  constructor(public readonly cause: any) {
    super(`Failed to deserialize message: ${cause?.message ?? cause}`);
    this.name = 'MessageDeserializationError';
  }
}

/**
 * Custom error thrown when a message is null or undefined.
 */
export class NullMessageError extends Error {
  constructor() {
    super('Received null message');
    this.name = 'NullMessageError';
  }
}

/**
 * Custom error thrown when a channel is not available.
 */
export class ChannelNotAvailableError extends Error {
  constructor() {
    super('channel is not available');
    this.name = 'ChannelNotAvailableError';
  }
}

/**
 * Custom error thrown when a connection is not available.
 */
export class ConnectionNotAvailableError extends Error {
  constructor() {
    super('connection is not available');
    this.name = 'ConnectionNotAvailableError';
  }
}
