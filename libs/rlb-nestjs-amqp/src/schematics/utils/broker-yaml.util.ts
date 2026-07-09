import { Document } from 'yaml';
import {
  findSeqItemByKey,
  seqItemExists,
  upsertSeqItemByKey,
  UpsertOptions,
  UpsertOutcome,
} from './yaml-config.util';

/**
 * Domain helpers for the `broker` section, layered on the generic YAML upsert. They encode the
 * cross-reference invariants the gotchas warn about (exchange type ⇒ routingKey required, topic
 * needs a queue for rpc/handle, dead-letter exchange must be declared, …) so each schematic's
 * index.ts stays a thin "read doc → ensureX → write doc".
 */

export type ExchangeType = 'direct' | 'topic' | 'fanout' | 'headers';
export type TopicMode = 'rpc' | 'handle' | 'broadcast' | 'event';

const EXCHANGES = ['broker', 'exchanges'];
const QUEUES = ['broker', 'queues'];
const TOPICS = ['topics'];

// --- existence / lookups ----------------------------------------------------

export function exchangeExists(doc: Document, name: string): boolean {
  return seqItemExists(doc, EXCHANGES, 'name', name);
}
export function queueExists(doc: Document, name: string): boolean {
  return seqItemExists(doc, QUEUES, 'name', name);
}
export function topicExists(doc: Document, name: string): boolean {
  return seqItemExists(doc, TOPICS, 'name', name);
}

/** The declared type of an exchange (used to decide whether a queue/topic needs a routingKey). */
export function getExchangeType(doc: Document, name: string): ExchangeType | undefined {
  const item = findSeqItemByKey(doc, EXCHANGES, 'name', name);
  return item ? (item.get('type') as ExchangeType | undefined) : undefined;
}

// --- ensure (idempotent upsert) --------------------------------------------

export interface ExchangeSpec {
  name: string;
  type?: ExchangeType;
  createExchangeIfNotExists?: boolean;
  durable?: boolean;
  autoDelete?: boolean;
  internal?: boolean;
}

export function ensureExchange(doc: Document, spec: ExchangeSpec, opts: UpsertOptions = {}): UpsertOutcome {
  const options = pruneEmpty({
    durable: spec.durable,
    autoDelete: spec.autoDelete,
    internal: spec.internal,
  });
  return upsertSeqItemByKey(
    doc,
    EXCHANGES,
    'name',
    {
      name: spec.name,
      type: spec.type ?? 'direct',
      createExchangeIfNotExists: spec.createExchangeIfNotExists ?? true,
      ...(options ? { options } : {}),
    },
    opts,
  );
}

export interface QueueSpec {
  name: string;
  exchange: string;
  /** Required (and only meaningful) when the exchange is a `topic` exchange. */
  routingKey?: string | string[];
  createQueueIfNotExists?: boolean;
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  /** Growth bounds (2.1.x hardening): message TTL / max length / unused-queue TTL, all in the queue options. */
  messageTtl?: number;
  maxLength?: number;
  expires?: number;
}

export function ensureQueue(doc: Document, spec: QueueSpec, opts: UpsertOptions = {}): UpsertOutcome {
  const options = pruneEmpty({
    durable: spec.durable,
    exclusive: spec.exclusive,
    autoDelete: spec.autoDelete,
    messageTtl: spec.messageTtl,
    maxLength: spec.maxLength,
    expires: spec.expires,
  });
  return upsertSeqItemByKey(
    doc,
    QUEUES,
    'name',
    {
      name: spec.name,
      exchange: spec.exchange,
      routingKey: spec.routingKey,
      createQueueIfNotExists: spec.createQueueIfNotExists ?? true,
      ...(options ? { options } : {}),
    },
    opts,
  );
}

export interface RetrySpec {
  maxAttempts?: number;
  delayMs?: number;
  onExhausted?: 'dead-letter' | 'drop';
  deadLetter?: { exchange: string; routingKey?: string };
}

export interface TopicSpec {
  name: string;
  mode: TopicMode;
  queue?: string;
  exchange?: string;
  routingKey?: string | string[];
  errorBehavior?: 'ack' | 'nack' | 'requeue';
  retry?: RetrySpec;
  mandatory?: boolean;
  persistent?: boolean;
  toObservable?: boolean;
}

export function ensureTopic(doc: Document, spec: TopicSpec, opts: UpsertOptions = {}): UpsertOutcome {
  const retry = spec.retry
    ? pruneEmpty({
        maxAttempts: spec.retry.maxAttempts,
        delayMs: spec.retry.delayMs,
        onExhausted: spec.retry.onExhausted,
        deadLetter: spec.retry.deadLetter,
      })
    : undefined;
  return upsertSeqItemByKey(
    doc,
    TOPICS,
    'name',
    {
      name: spec.name,
      mode: spec.mode,
      queue: spec.queue,
      exchange: spec.exchange,
      routingKey: spec.routingKey,
      errorBehavior: spec.errorBehavior,
      retry,
      mandatory: spec.mandatory,
      persistent: spec.persistent,
      toObservable: spec.toObservable,
    },
    opts,
  );
}

/** `true` when the exchange is a topic exchange, so a bound queue/topic MUST carry a routingKey. */
export function routingKeyRequired(doc: Document, exchangeName: string): boolean {
  return getExchangeType(doc, exchangeName) === 'topic';
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}
