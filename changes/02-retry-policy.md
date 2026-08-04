# 02 — Retry policy bounded (fine del requeue infinito) 🟠 Cambio di default

**Riguarda:** Microservizi (consumer) in primis; il Gateway ne subisce l'effetto lato HTTP (mappa a 502).

## Cosa è cambiato

Il vecchio comportamento di default su errore dell'handler era un **nack-requeue infinito** — un
messaggio "poison" poteva mandare in hot-loop un consumer per sempre. Ora esiste una **retry policy
limitata**:

- Un messaggio che fallisce viene ripubblicato un numero **finito** di volte (opzionalmente con delay),
  poi **dead-letter** o **drop**.
- **Default built-in** (se non configuri nulla e non c'è un `errorBehavior` legacy):
  **5 tentativi, nessun delay, poi drop** con log di errore.
- Un RPC esaurito risponde con l'errore **`RetryExhaustedError`**, che il **gateway mappa a HTTP 502**
  (il chiamante fallisce subito invece di aspettare tutto il timeout RPC).
- Fallimenti di **deserializzazione / validazione pipe** **non** vengono ritentati (inutile: fallirebbero
  sempre).

## Precedenze

Dal più forte al più debole:

1. `errorHandler` / `errorBehavior` (per-subscription) — **legacy, vince** se presente.
2. `topics[].retry` (per-topic).
3. `broker.retry` (globale).
4. Default built-in (5 → drop).

> Se hai un `defaultSubscribeErrorBehavior` o un `errorBehavior` per-topic **esplicito**, quello
> continua a vincere: per adottare la nuova policy **rimuovilo** e definisci `retry`.

## Modifica consigliata — YAML del MS

Definisci una policy esplicita con dead-letter (evita drop silenziosi in produzione):

```yaml
broker:
  # ...
  retry:                          # policy di default per TUTTI i consumer
    maxAttempts: 5                # tentativi totali inclusa la prima consegna (default 5)
    delayMs: 5000                 # attesa tra tentativi via wait-queue TTL <queue>.retry.<delayMs> (default 0)
    onExhausted: dead-letter      # dead-letter | drop (default: dead-letter se deadLetter è settato, altrimenti drop)
    deadLetter:
      exchange: rlb-dlx           # ⚠️ DEVE essere dichiarato in broker.exchanges (NON viene auto-asserito)
      routingKey: my-key          # opzionale; default = routing key originale del messaggio

  exchanges:
    - name: rlb-dlx               # <-- l'exchange di dead-letter va dichiarato qui
      type: topic
      createExchangeIfNotExists: true
      options: { durable: true }
```

Override per singolo topic:

```yaml
topics:
  - name: heavy-job
    mode: handle
    queue: heavy-job
    exchange: rlb
    retry:                        # override di broker.retry per questo topic
      maxAttempts: 3
      delayMs: 1000
      onExhausted: drop
```

## Note operative

- Con `delayMs > 0` la lib crea una **wait-queue TTL** `<queue>.retry.<delayMs>` che fa dead-letter di
  ritorno sulla coda di lavoro: nessun timer lato consumer.
- Se `deadLetter.exchange` **non è dichiarato** in `broker.exchanges`, la pubblicazione di dead-letter
  fallisce e il messaggio ripiega su un singolo nack-requeue.
- Headers diagnostici stampati sulle copie: `x-retry-count`, e sui dead-letter `x-retry-error`,
  `x-retry-origin-queue`.

## Impatto lato Gateway

Nessuna modifica di config obbligatoria, ma i client HTTP possono ora ricevere **502** (invece di un
timeout) quando l'RPC a valle esaurisce i tentativi. Aggiorna eventuali retry/monitoring dei consumer
HTTP di conseguenza.

## Checklist

- [ ] Definita `broker.retry` esplicita nei MS (con `deadLetter` in produzione).
- [ ] Dichiarato l'exchange di dead-letter in `broker.exchanges`.
- [ ] Rimossi i `defaultSubscribeErrorBehavior` / `errorBehavior` che non servono più (altrimenti "vincono" sul retry).
- [ ] Gestito il nuovo `502` (`RetryExhaustedError`) lato client del gateway.
