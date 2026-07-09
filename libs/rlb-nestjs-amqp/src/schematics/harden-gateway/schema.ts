export interface HardenGatewayOptions {
  /** gateway.maxConcurrentRequests — global in-flight request cap. */
  maxConcurrentRequests?: number;
  /** gateway.maxBodyBytes — non-multipart body limit (e.g. '5mb'). Also drives the main.ts patch. */
  maxBodyBytes?: string | number;
  /** gateway.upload.maxFileSizeMb — per-file multipart limit. */
  uploadMaxFileSizeMb?: number;
  /** gateway.upload.maxFiles — max files per multipart request. */
  uploadMaxFiles?: number;
  /** gateway.ws.maxBufferedBytes — per-socket outbound backpressure cap. */
  wsMaxBufferedBytes?: number;
  /** gateway.ws.maxMessageBytes — inbound WS frame limit. */
  wsMaxMessageBytes?: number;
  /** gateway.ws.allowedOrigins — CORS allow-list for the WS upgrade. */
  allowedOrigins?: string[];
  /** Also patch main.ts to re-register the body parsers with maxBodyBytes. Default: true. */
  patchMain?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
