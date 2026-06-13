export interface HttpMetric<Id = string> {
  _id?: Id;
  method: string;
  /** Route template that was matched (e.g. /users/:id) or the raw path. */
  route: string;
  name?: string;
  topic?: string;
  action?: string;
  count: number;
  errorCount: number;
  lastStatus?: number;
  lastCalledAt?: number;
  totalDurationMs: number;
}

export interface TrackCallInput {
  method: string;
  route: string;
  name?: string;
  topic?: string;
  action?: string;
  status?: number;
  durationMs?: number;
}
