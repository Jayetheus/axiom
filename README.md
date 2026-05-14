<div align="center">
  <img src="https://raw.githubusercontent.com/jayetheus/axiom/main/assets/logo.png" alt="Axiom logo" width="400" />
  <h1>Axiom</h1>
  <p><strong>Offline-first fetch for React, Next.js, React Native, and TypeScript apps.</strong></p>
  <p>Queue writes when the network fails. Replay them safely with backoff, persistence, and developer-friendly hooks.</p>

  <p>
    <a href="https://www.npmjs.com/package/@jayethian/axiom">
      <img src="https://img.shields.io/npm/v/@jayethian/axiom.svg?style=flat-square" alt="npm version" />
    </a>
    <a href="https://www.npmjs.com/package/@jayethian/axiom">
      <img src="https://img.shields.io/npm/dm/@jayethian/axiom.svg?style=flat-square" alt="npm downloads" />
    </a>
    <a href="https://opensource.org/licenses/MIT">
      <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT" />
    </a>
  </p>
</div>

## Why Axiom

Most apps handle offline writes badly:

- the request fails
- the user retries
- the backend gets duplicates
- the frontend loses track of what actually happened

Axiom wraps `fetch` with an opinionated offline workflow:

- mutation requests can be queued when the network drops
- requests persist locally with `IndexedDB`, `localStorage`, or a custom adapter
- retries run with exponential backoff and jitter
- dead letters are surfaced for intervention instead of silently looping forever
- React apps get queue state and sync controls out of the box

## What It Guarantees

Axiom provides **at-least-once delivery**, not exactly-once execution.

That is the right tradeoff for an offline client, but it means your backend should honor the `Idempotency-Key` header that Axiom sends for mutations by default. If your API already supports idempotent writes, Axiom fits naturally.

## Installation

```bash
npm install @jayethian/axiom
# or
yarn add @jayethian/axiom
# or
pnpm add @jayethian/axiom
```

## Quick Start

```tsx
import { AxiomProvider, axiom } from "@jayethian/axiom";

export default function App({ children }) {
  return (
    <AxiomProvider
      config={{
        baseURL: "https://api.myapp.com",
        timeout: 8000,
        maxRetries: 5,
      }}
      fallbackAdapter="indexeddb"
    >
      {children}
    </AxiomProvider>
  );
}

async function saveOrder(payload: unknown) {
  const result = await axiom.post("/orders", payload, {
    idempotencyKey: "order-123",
  });

  if (result.isQueued) {
    console.log("Offline. Order queued for background replay.");
  }
}
```

## Core Value

```ts
// Standard fetch:
await fetch("/api/orders", {
  method: "POST",
  body: JSON.stringify(order),
});

// Axiom:
await axiom.post("/orders", order, {
  idempotencyKey: order.id,
});
```

When the network is stable, it behaves like a normal request flow.  
When the network fails, Axiom stores the write and retries it later instead of dropping the action on the floor.

## Features

- Persistent offline queue with built-in `IndexedDB`, `localStorage`, and memory adapters.
- Automatic idempotency-key injection for `POST`, `PUT`, `PATCH`, and `DELETE`.
- Sequential replay with batching, exponential backoff, and jitter.
- Dead-letter support for permanently failing requests.
- Queue deduplication for repeated explicit idempotency keys.
- `onBeforeSync` hook for refreshing auth headers before replay.
- React provider and hooks for queue inspection and manual sync.
- Custom storage adapter support for MMKV, AsyncStorage, or internal platform stores.

## React and Next.js

For web apps, `AxiomProvider` automatically binds to the browser `online` and `offline` events.

```tsx
import { AxiomProvider } from "@jayethian/axiom";

export function RootLayout({ children }) {
  return (
    <AxiomProvider
      config={{
        baseURL: "https://api.myapp.com",
        retryBaseDelayMs: 1500,
        maxRetries: 4,
      }}
      fallbackAdapter="indexeddb"
    >
      {children}
    </AxiomProvider>
  );
}
```

Note: in SSR environments, persistence only exists on the client. Server runtimes fall back to memory storage.

## React Native

React Native does not provide `window`, `IndexedDB`, or `localStorage`, so you should pass both:

- a custom `networkListener`
- a persistent `storageAdapter`

```tsx
import NetInfo from "@react-native-community/netinfo";
import { MMKV } from "react-native-mmkv";
import {
  AxiomProvider,
  AxiomStorageAdapter,
  QueuedRequest,
} from "@jayethian/axiom";

const mmkv = new MMKV();

class MMKVAdapter implements AxiomStorageAdapter {
  private queueKey = "axiom_queue";
  private deadLetterKey = "axiom_dead_letters";

  private read(key: string): QueuedRequest[] {
    const value = mmkv.getString(key);
    return value ? JSON.parse(value) : [];
  }

  private write(key: string, value: QueuedRequest[]) {
    mmkv.set(key, JSON.stringify(value));
  }

  async save(request: QueuedRequest) {
    const queue = this.read(this.queueKey).filter((item) => item.id !== request.id);
    queue.push(request);
    this.write(this.queueKey, queue);
  }

  async getAll() {
    return this.read(this.queueKey);
  }

  async remove(id: string) {
    this.write(
      this.queueKey,
      this.read(this.queueKey).filter((item) => item.id !== id),
    );
  }

  async clearAll() {
    mmkv.delete(this.queueKey);
  }

  async saveDeadLetter(request: QueuedRequest) {
    const queue = this.read(this.deadLetterKey).filter((item) => item.id !== request.id);
    queue.push(request);
    this.write(this.deadLetterKey, queue);
  }

  async getDeadLetters() {
    return this.read(this.deadLetterKey);
  }

  async clearDeadLetters() {
    mmkv.delete(this.deadLetterKey);
  }
}

export default function App({ children }) {
  return (
    <AxiomProvider
      config={{ baseURL: "https://api.myapp.com" }}
      storageAdapter={new MMKVAdapter()}
      networkListener={(callback) =>
        NetInfo.addEventListener((state) => callback(Boolean(state.isConnected)))
      }
    >
      {children}
    </AxiomProvider>
  );
}
```

## Vanilla TypeScript Usage

```ts
import { axiom } from "@jayethian/axiom";

axiom.create({
  baseURL: "https://api.myapp.com",
  maxRetries: 4,
});

axiom.on("syncSuccess", ({ request, response }) => {
  console.log("Synced:", request.url, response);
});

axiom.on("syncFailure", ({ request, status, willRetry, nextRetryAt }) => {
  console.log("Sync failed:", request.url, status, willRetry, nextRetryAt);
});

await axiom.post("/orders", { sku: "book-1" }, { idempotencyKey: "book-1" });
```

## React Hooks

```tsx
import { axiom, useAxiomQueue } from "@jayethian/axiom";

export function CheckoutButton() {
  const { isOnline, inspectQueue, deadLetters, forceSync } = useAxiomQueue();

  const submit = async () => {
    const result = await axiom.post("/checkout", { sku: "book-1" }, {
      idempotencyKey: "checkout-book-1",
    });

    if (result.isQueued) {
      const pending = await inspectQueue();
      console.log("Queued requests:", pending.length);
    }
  };

  return (
    <div>
      <button onClick={submit}>Save order</button>
      <button onClick={forceSync} disabled={!isOnline}>
        Force sync
      </button>
      {deadLetters.length > 0 && <p>Some requests need manual attention.</p>}
    </div>
  );
}
```

## Configuration

### `AxiomConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `baseURL` | `string` | `undefined` | Prepends a base URL to request paths. |
| `defaultHeaders` | `Record<string, string>` | `{}` | Global headers applied to every request. |
| `timeout` | `number` | `8000` | Foreground request timeout in milliseconds. |
| `maxRetries` | `number` | `3` | Attempts before a queued request is dead-lettered. |
| `queueReads` | `boolean` | `false` | Allows replaying failed `GET` requests. |
| `autoIdempotency` | `boolean` | `true` | Injects an `Idempotency-Key` when one is not provided. |
| `retryBaseDelayMs` | `number` | `1000` | Base delay for exponential retry backoff. |
| `retryMaxDelayMs` | `number` | `30000` | Upper bound for retry backoff. |
| `retryJitter` | `number` | `0.2` | Randomization ratio used to spread retries. |
| `syncBatchSize` | `number` | `10` | Maximum eligible requests processed per flush. |
| `fallbackAdapter` | `"indexeddb" \| "localstorage" \| "memory"` | `"memory"` | Built-in storage adapter preference. |

### `AxiomRequestOptions`

| Property | Type | Description |
| --- | --- | --- |
| `priority` | `"urgent" \| "background"` | Reorders queued items during replay. |
| `timeout` | `number` | Overrides the foreground timeout for a single request. |
| `headers` | `Record<string, string>` | Appends or overwrites request headers. |
| `idempotencyKey` | `string` | Explicit key for backend dedupe. |
| `metadata` | `any` | Custom metadata persisted with the queue entry. |

## Production Notes

- Mutations are queued by default. `GET` requests are not queued unless `queueReads: true` is enabled.
- Axiom retries sequentially and stops the active flush after the first transient failure to avoid storming weak links.
- Automatic idempotency keys make delayed writes safer, but the strongest dedupe comes from passing your own stable business key.
- Dead letters are only persisted when the active storage adapter implements `saveDeadLetter`, `getDeadLetters`, and `clearDeadLetters`.
- `onBeforeSync` should only mutate headers or metadata. Do not mutate the queued request `id`.

## Roadmap-Friendly Use Cases

- Checkout and payment intent creation
- Field sales apps with unstable mobile coverage
- Offline-first note taking and data collection
- Queue-backed mobile mutations in React Native
- Admin tools that need reliable background replay without dragging in a full sync framework

## Contributing

Contributions, issues, and feature requests are welcome at [Jayetheus/axiom](https://github.com/jayetheus/axiom).

## License

MIT. Built by [Jayetheus](https://github.com/jayetheus).
