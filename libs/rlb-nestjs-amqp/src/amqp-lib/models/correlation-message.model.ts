export interface CorrelationMessage {
  correlationId: string;
  requestId?: string;
  message: Record<string, unknown>;
}