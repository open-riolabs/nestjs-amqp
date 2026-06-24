/** DI token for an array of consumer-supplied dependency health probes (database, redis, external
 *  APIs). The gateway runs them in gw-health and aggregates; the broker connection is checked
 *  built-in. Register: `{ provide: RLB_GW_HEALTH_INDICATORS, useValue: [ { name, check } ] }`. */
export const RLB_GW_HEALTH_INDICATORS = 'RLB_GW_HEALTH_INDICATORS';

export interface GatewayHealthCheck {
  status: 'up' | 'down';
  /** Optional extra context (error message, latency, version, ...). */
  detail?: any;
}

/** A single dependency probe supplied by the consuming app (it owns the DB/redis/HTTP clients). */
export interface GatewayHealthIndicator {
  /** Identifier shown in the report, e.g. 'database', 'redis', 'payments-api'. */
  name: string;
  check(): Promise<GatewayHealthCheck>;
}

/** Aggregated readiness report returned by gw-health. `status` is 'down' when the broker OR any
 *  dependency is down. */
export interface GatewayHealthReport {
  status: 'up' | 'down';
  broker: GatewayHealthCheck;
  dependencies: Record<string, GatewayHealthCheck>;
}
