<div align="center">
  <img src="https://raw.githubusercontent.com/jayethian/axiom/main/assets/logo.png" alt="axiom logo" width="400" />
  <h1>Axiom</h1>

  <h3>Resilient, offline-first networking for modern React, Next.js, and React Native apps.</h3>
  
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
    <img src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg?style=flat-square" alt="TypeScript" />
  </p>
</div>

<br />

## The Problem
Standard HTTP clients like **Axios** or **Fetch** assume a stable connection. When a user submits data in a dead zone (elevators, basements, rural areas), the request simply fails. Without a complex, manual retry system written from scratch, **that data is gone forever.**

## The Axiom Way
Axiom intercepts network failures and timeouts. Instead of throwing an error, it serializes the request and safely moves it to a persistent local queue. When the connection returns, Axiom flushes the queue automatically, in the background.

```typescript
// Standard Fetch: Fails and loses data when offline.
await fetch('/api/orders', { method: 'POST', body: data }); 

// Axiom: Intercepts drop, queues safely, and syncs when back online.
await axiom.post('/api/orders', data); 

```

---

## Table of Contents

1. [Features](https://www.google.com/search?q=%23-features)
2. [Installation](https://www.google.com/search?q=%23-installation)
3. [React / Next.js Setup](https://www.google.com/search?q=%23-react--nextjs-setup-zero-config)
4. [React Native Setup](https://www.google.com/search?q=%23-react-native-setup)
5. [Vanilla JS / Node Setup](https://www.google.com/search?q=%23-vanilla-js--node-setup)
6. [Core Hooks (`useAxiomQueue`)](https://www.google.com/search?q=%23-core-hooks)
7. [Advanced Architecture](https://www.google.com/search?q=%23-advanced-architecture)
* [Global Interceptors](https://www.google.com/search?q=%23global-interceptors)
* [Priority Lanes](https://www.google.com/search?q=%23priority-lanes)
* [Queue Inspection & "Outbox" UI](https://www.google.com/search?q=%23queue-inspection--outbox-ui)
* [Storage Adapters (MMKV, IndexedDB)](https://www.google.com/search?q=%23storage-adapters)


8. [API Reference](https://www.google.com/search?q=%23-api-reference)

---

## Features

* **📱 Mobile-First Resilience:** Specifically tuned to handle spotty connectivity, aggressive timeouts, and background execution.
* **🧠 Smart Fallback Storage:** Automatically detects your environment and falls back to the safest storage (`IndexedDB` for Web, `Memory` for SSR/React Native) without crashing.
* **🔄 Autonomous Background Sync:** Replays the queue the moment a signal is detected.
* **⚡ Priority Lanes:** Ensure critical data (e.g., payments) jumps to the front of the queue ahead of background tasks (e.g., analytics).
* **🛡️ Just-In-Time Headers:** Refresh Auth Tokens immediately before syncing to prevent `401 Unauthorized` errors on delayed requests.
* **🔌 Global Interceptors:** Catch success and error events globally, even when requests resolve in the background hours later.
* **🪦 Dead Letter Queues:** Protects your app from infinite loops by isolating permanently failing requests and exposing them to the UI for user intervention.

---

## Installation

```bash
npm install @jayethian/axiom
# or
yarn add @jayethian/axiom
# or
pnpm add @jayethian/axiom

```

---

## React & Next.js Setup (Zero-Config)
Axiom includes a built-in event listener that automatically binds to the browser's `window.addEventListener('online')` APIs. For Next.js and standard React Web apps, setup requires zero boilerplate.

```tsx
// App.tsx or layout.tsx
import { AxiomProvider } from '@jayethian/axiom';

export default function App({ children }) {
  return (
    <AxiomProvider
      config={{ 
        baseURL: '[https://api.myapp.com](https://api.myapp.com)', 
        timeout: 8000 
      }}
      // Automatically uses IndexedDB, falls back to LocalStorage if in Private Browsing
      fallbackAdapter="indexeddb" 
    >
      {children}
    </AxiomProvider>
  );
}

```

---

## React Native Setup

React Native does not have a native DOM `window`, so you must provide a network listener (like `@react-native-community/netinfo`) and a persistent storage adapter (like `react-native-mmkv` or `AsyncStorage`).

```tsx
import { AxiomProvider } from '@jayethian/axiom';
import NetInfo from '@react-native-community/netinfo';
import { MMKVAdapter } from './my-adapters'; // See Storage Adapters below

export default function App({ children }) {
  return (
    <AxiomProvider
      config={{ baseURL: '[https://api.myapp.com](https://api.myapp.com)' }}
      storageAdapter={new MMKVAdapter()}
      networkListener={(callback) => {
        return NetInfo.addEventListener(state => callback(!!state.isConnected));
      }}
    >
      {children}
    </AxiomProvider>
  );
}

```

---

## Vanilla JS / Node Setup

You do not need React to use Axiom. You can instantiate the engine directly and use our built-in **Event Emitter** to listen for background syncs.

```typescript
import { axiom } from '@jayethian/axiom';

// 1. Initialize
axiom.create({ baseURL: '[https://api.myapp.com](https://api.myapp.com)' });

// 2. Listen to Background Events
axiom.on('syncSuccess', (data, req) => {
  console.log(`Background sync finished for ${req.url}`);
});

axiom.on('deadLetter', (req) => {
  console.error(`Request permanently failed after 3 retries:`, req);
});

// 3. Make Requests
const response = await axiom.post('/users', { name: 'John' });

```

---

## Core Hooks

The `useAxiomQueue` hook gives your UI complete visibility into the background engine. Keep your users informed when they are working offline.

```tsx
import { axiom, useAxiomQueue } from '@jayethian/axiom';

export function CheckoutButton() {
  const { isOnline, deadLetters, clearDeadLetters } = useAxiomQueue();

  const onSave = async (data) => {
    // If offline, returns a 202 and flags isQueued: true
    const res = await axiom.post('/checkout', data, { priority: 'urgent' });
    
    if (res.isQueued) {
      alert("Working offline. Your order will sync automatically!");
    }
  };

  return (
    <div>
      {!isOnline && <Banner>You are offline. Actions will be saved.</Banner>}
      {deadLetters.length > 0 && <ErrorBanner>Some actions failed to save.</ErrorBanner>}
      
      <button onClick={onSave}>Checkout</button>
    </div>
  );
}

```

---

## Advanced Architecture

### Global Interceptors

Axiom allows you to intercept requests exactly like Axios, but it applies these rules to **background syncs** as well.

```tsx
<AxiomProvider
  config={{
    // Triggered globally whenever a request hard-fails (e.g., 500, 401)
    onError: (status, error, request) => {
      if (status === 401) {
        AuthService.logout(); // Global logout on token expiration
      }
    },
    // Triggered globally whenever ANY request succeeds (immediate or background)
    onResponse: (data, status, request) => {
      if (request.url.includes('/payment')) {
        Analytics.track('Payment Successful');
      }
    }
  }}
>

```

### Priority Lanes

By default, Axiom queues requests First-In-First-Out (FIFO). However, you can force critical requests to jump to the front of the line when the network returns.

```typescript
// This stays at the back of the line (queued in the background)
axiom.post('/analytics', logData, { priority: 'background' });

// This jumps to the front and syncs first when the connection returns
axiom.post('/chat/send', message, { priority: 'urgent' });

```

### Queue Inspection & "Outbox" UI

Give your users the ability to see what is waiting to sync, and let them cancel actions before the network returns.

```tsx
import { useAxiomQueue } from '@jayethian/axiom';

export function Outbox() {
  const { inspectQueue, cancelRequest } = useAxiomQueue();
  const [pending, setPending] = useState([]);

  useEffect(() => {
    inspectQueue().then(setPending);
  }, []);

  return (
    <ul>
      {pending.map(req => (
        <li key={req.id}>
          Pending: {req.method} {req.url}
          <button onClick={() => cancelRequest(req.id)}>Cancel</button>
        </li>
      ))}
    </ul>
  );
}

```

### Just-In-Time Headers

If a user is offline for 4 hours, their JWT will likely expire. If Axiom attempts to sync the old request, the server will reject it. `onBeforeSync` allows you to inject fresh tokens *milliseconds* before the queue flushes.

```tsx
<AxiomProvider
  config={{
    onBeforeSync: async (request) => {
      const freshToken = await getValidAuthToken(); // Your logic
      return {
        ...request,
        headers: { ...request.headers, Authorization: `Bearer ${freshToken}` }
      };
    }
  }}
>

```

### Storage Adapters

Axiom comes with `IndexedDB`, `LocalStorage`, and `Memory` adapters out of the box. For React Native, building a custom adapter using a high-performance library like MMKV is incredibly simple.

```typescript
import { MMKV } from 'react-native-mmkv';
import { AxiomStorageAdapter, QueuedRequest } from '@jayethian/axiom';

const mmkv = new MMKV();

export class MMKVAdapter implements AxiomStorageAdapter {
  private key = 'axiom_queue';

  private getQ(): QueuedRequest[] {
    const data = mmkv.getString(this.key);
    return data ? JSON.parse(data) : [];
  }

  async save(req: QueuedRequest) { 
    const q = this.getQ();
    q.push(req);
    mmkv.set(this.key, JSON.stringify(q)); 
  }
  
  async getAll() { return this.getQ(); }
  
  async remove(id: string) { 
    const q = this.getQ().filter(r => r.id !== id);
    mmkv.set(this.key, JSON.stringify(q));
  }
  
  async clearAll() { mmkv.delete(this.key); }
}

// Pass it to the provider:
<AxiomProvider storageAdapter={new MMKVAdapter()} {...props} />

```

---

## API Reference

### `AxiomConfig`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `baseURL` | `string` | `undefined` | Prepend this to all request URLs. |
| `defaultHeaders` | `Record<string, string>` | `{}` | Global headers applied to all requests. |
| `timeout` | `number` | `8000` | MS before a request is aborted and moved to the offline queue. |
| `maxRetries` | `number` | `3` | Attempts before a background sync fails permanently. |
| `fallbackAdapter` | `'indexeddb' | 'localstorage' | 'memory'` | `'memory'` | The internal adapter to use if `storageAdapter` is omitted. |
| `debug` | `boolean` | `false` | Prints verbose engine logs to the console. |

### `AxiomRequestOptions`

Passed as the third parameter to `axiom.post`, `axiom.get`, etc.

| Property | Type | Description |
| --- | --- | --- |
| `priority` | `'urgent' | 'background'` | Determines sort order when the queue flushes. |
| `timeout` | `number` | Overrides the global timeout for this specific request. |
| `headers` | `Record<string, string>` | Append or overwrite global headers for this request. |
| `metadata` | `any` | Attach custom UI data to the request. Survives serialization. |

---

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://www.google.com/search?q=https://github.com/jayethian/axiom/issues).

## 📄 License

This project is [MIT](https://opensource.org/licenses/MIT) licensed. Built with ⚡️ by [Jayetheus](https://www.google.com/search?q=https://github.com/jayethian).
