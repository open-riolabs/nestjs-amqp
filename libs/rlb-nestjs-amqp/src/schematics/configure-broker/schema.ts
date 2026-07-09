export interface ConfigureBrokerOptions {
  /** broker.uri (the AMQP connection string). */
  uri?: string;
  /** broker.prefetchCount (channel prefetch). */
  prefetchCount?: number;
  /** broker.defaultRpcTimeout (ms). */
  defaultRpcTimeout?: number;
  /** connectionManagerOptions.heartbeatIntervalInSeconds. */
  heartbeatIntervalInSeconds?: number;
  /** connectionManagerOptions.reconnectTimeInSeconds. */
  reconnectTimeInSeconds?: number;
  /** SASL mechanism used in connectionOptions.credentials. */
  mechanism?: 'PLAIN' | 'EXTERNAL' | 'AMQPLAIN';
  /** connectionOptions.credentials.username. */
  username?: string;
  /** connectionOptions.credentials.password. */
  password?: string;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
