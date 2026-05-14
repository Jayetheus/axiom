<div align="center">
  <img src="https://raw.githubusercontent.com/jayetheus/axiom/main/assets/logo.png" alt="axiom logo" width="400" />
  <h1>Axiom</h1>
  <h3>Offline-first fetch with persistent replay, backoff, and React and React Native helpers.</h3>

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

## What Axiom Guarantees

Axiom is an offline-first wrapper around `fetch` for React, Next.js, React Native, and vanilla TypeScript apps. When a supported request fails because the network is unavailable or unstable, the request is serialized into a local queue and replayed later.

Important: Axiom provides **at-least-once delivery**, not exactly-once execution. To make delayed writes safe in production, your backend should honor the `Idempotency-Key` header that Axiom sends for mutations by default.

## Features

- Persistent queue storage with `IndexedDB`, `localStorage`, or a custom adapter.
- Automatic idempotency-key injection for `POST`, `PUT`, `PATCH`, and `DELETE`.
- Queue deduplication for repeated explicit idempotency keys, and for payload fingerprints when auto-idempotency is disabled.
- Exponential retry backoff with jitter and dead-letter persistence.
- Batched replay to avoid reconnect storms on weak connections.
- React helpers for queue inspection, dead letters, and manual sync.
- `onBeforeSync` hook for fresh auth headers right before replay.

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
import { AxiomProvider } from "@jayethian/axiom";

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
```

## React and Next.js

In web apps, `AxiomProvider` binds to the browser `online` and `offline` events automatically. For SSR frameworks like Next.js, persistent queue behavior only exists on the client, because server environments fall back to memory storage.

```tsx
import { AxiomProvider } from "@jayethian/axiom";

export function RootLayout({ children }) {
  return (
    <AxiomProvider
      config={{
        baseURL: "https://api.myapp.com",
        fallbackAdapter: "indexeddb",
      }}
      fallbackAdapter="indexeddb"
    >
      {children}
    </AxiomProvider>
  );
}
```

## React Native

React Native does not expose `window`, `IndexedDB`, or `localStorage`, so you should provide both a network listener and a persistent adapter such as MMKV or AsyncStorage.

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
    const queue = this.read(this.queueKey).filter(
      (item) => item.id !== request.id,
    );
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
    const queue = this.read(this.deadLetterKey).filter(
      (item) => item.id !== request.id,
    );
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
        NetInfo.addEventListener((state) =>
          callback(Boolean(state.isConnected)),
        )
      }
    >
      {children}
    </AxiomProvider>
  );
}
```

## Vanilla Usage

```ts
import { axiom } from "@jayethian/axiom";

axiom.create({
  baseURL: "https://api.myapp.com",
  maxRetries: 4,
});

axiom.on("syncSuccess", ({ request, response }) => {
  console.log("Synced", request.url, response);
});

axiom.on("syncFailure", ({ request, status, willRetry, nextRetryAt }) => {
  console.log("Failed", request.url, status, willRetry, nextRetryAt);
});

await axiom.post("/orders", { sku: "book-1" });
```

## React Hooks

```tsx
import { axiom, useAxiomQueue } from "@jayethian/axiom";

export function CheckoutButton() {
  const { isOnline, inspectQueue, deadLetters } = useAxiomQueue();

  const submit = async () => {
    const result = await axiom.post("/checkout", { sku: "book-1" });
    if (result.isQueued) {
      console.log("Queued for background replay");
      const pending = await inspectQueue();
      console.log("Pending requests", pending.length);
    }
  };

  return (
    <button disabled={!isOnline && deadLetters.length > 0} onClick={submit}>
      Save order
    </button>
  );
}
```

## Production Notes

- Mutations are queued by default. `GET` requests are not queued unless `queueReads: true` is enabled.
- Replay is sequential and batched. Axiom stops the current flush after the first transient failure and schedules exponential backoff with jitter.
- Repeated mutations only dedupe automatically when you reuse the same explicit `idempotencyKey`. The generated fallback keys are unique on purpose.
- Dead letters are persisted when the adapter supports `saveDeadLetter`, `getDeadLetters`, and `clearDeadLetters`.
- `onBeforeSync` should only mutate headers or metadata. Do not change the queued request `id`.

## API Reference

### `AxiomConfig`

| Property           | Type                                        | Default     | Description                                            |
| ------------------ | ------------------------------------------- | ----------- | ------------------------------------------------------ |
| `baseURL`          | `string`                                    | `undefined` | Prepends a base URL to request paths.                  |
| `defaultHeaders`   | `Record<string, string>`                    | `{}`        | Global headers applied to every request.               |
| `timeout`          | `number`                                    | `8000`      | Foreground request timeout in milliseconds.            |
| `maxRetries`       | `number`                                    | `3`         | Attempts before a queued request is dead-lettered.     |
| `queueReads`       | `boolean`                                   | `false`     | Allows replaying failed `GET` requests.                |
| `autoIdempotency`  | `boolean`                                   | `true`      | Injects an `Idempotency-Key` when one is not provided. |
| `retryBaseDelayMs` | `number`                                    | `1000`      | Base delay for exponential retry backoff.              |
| `retryMaxDelayMs`  | `number`                                    | `30000`     | Upper bound for retry backoff.                         |
| `retryJitter`      | `number`                                    | `0.2`       | Randomization ratio used to spread retries.            |
| `syncBatchSize`    | `number`                                    | `10`        | Maximum eligible requests processed per flush.         |
| `fallbackAdapter`  | `"indexeddb" \| "localstorage" \| "memory"` | `"memory"`  | Built-in storage adapter preference.                   |

### `AxiomRequestOptions`

| Property         | Type                       | Description                                            |
| ---------------- | -------------------------- | ------------------------------------------------------ |
| `priority`       | `"urgent" \| "background"` | Reorders queued items during replay.                   |
| `timeout`        | `number`                   | Overrides the foreground timeout for a single request. |
| `headers`        | `Record<string, string>`   | Appends or overwrites request headers.                 |
| `idempotencyKey` | `string`                   | Explicit key for backend dedupe.                       |
| `metadata`       | `any`                      | Custom metadata persisted with the queue entry.        |

## Contributing

Contributions, issues, and feature requests are welcome at [Jayetheus/axiom](https://github.com/jayetheus/axiom).

## License

MIT. Built by [Jayetheus](https://github.com/jayetheus).
