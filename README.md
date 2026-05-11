<div align="center">
  <img src="./assets/logo.png" alt="axiom logo" width="400" />
  <h1>Axiom</h1>

  <h3>Resilient, offline-first networking for modern React apps.</h3>
  
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
Standard HTTP clients like **Axios** or **Fetch** assume a stable connection. When a user submits data in a dead zone (elevators, basements, rural areas), the request simply fails. Without a complex manual retry system, **that data is gone forever.**

## The Axiom Way
Axiom intercepts network failures and timeouts. Instead of throwing an error, it serializes the request and moves it to a persistent local queue. When the connection returns, Axiom flushes the queue automatically.

```typescript
// Standard Fetch: Fails and loses data when offline.
await fetch('/api/orders', { method: 'POST', body: data }); 

// Axiom: Intercepts drop, queues safely, and syncs when back online.
await axiom.post('/api/orders', data); 

```

---

## Key Features

* **📱 Mobile-First Resilience:** Specifically tuned for React Native's shaky connectivity.
* **🔄 Autonomous Background Sync:** Replays the queue the moment a signal is detected.
* **⚡ Priority Lanes:** Ensure critical data (e.g., payments) jumps to the front of the queue ahead of background tasks (e.g., analytics).
* **🛡️ Just-In-Time Headers:** Refresh Auth Tokens immediately before syncing to prevent `401 Unauthorized` errors on old requests.
* **💾 Storage Agnostic:** Use the high-performance storage of your choice (**MMKV**, **SQLite**, **IndexedDB**).
* **🪦 Dead Letter Queues:** Protects your app from infinite loops by isolating permanently failing requests.

---

## Installation

```bash
yarn add @jayethian/axiom
# or
npm install @jayethian/axiom

```

---

## Setup & Usage

### 1. Initialize the Provider

Wrap your app root. Axiom doesn't force a specific network library on you—just pass in your preferred listener (like NetInfo).

```tsx
import { AxiomProvider } from '@jayethian/axiom';
import NetInfo from '@react-native-community/netinfo';

export default function App() {
  return (
    <AxiomProvider
      config={{ baseURL: '[https://api.myapp.com](https://api.myapp.com)', timeout: 10000 }}
      networkListener={(callback) => {
        return NetInfo.addEventListener(state => callback(!!state.isConnected));
      }}
    >
      <Main />
    </AxiomProvider>
  );
}

```

### 2. Use Hooks for Better UX

Keep your users informed when they are working offline.

```tsx
import { axiom, useAxiomQueue } from '@jayethian/axiom';

const { isOnline } = useAxiomQueue();

const onSave = async (data) => {
  const res = await axiom.post('/profile', data, { priority: 'urgent' });
  
  if (res.isQueued) {
    showToast("Working offline. Your changes will sync automatically!");
  }
};

```

---

## Advanced Configuration

### Priority Lanes

Prevent large background uploads from blocking small, critical API calls.

```typescript
// This stays at the back of the line
axiom.post('/analytics', logData, { priority: 'background' });

// This jumps to the front
axiom.post('/chat/send', message, { priority: 'urgent' });

```

### Just-In-Time Headers

Refresh your JWT right before the queue fires to ensure every request is authorized.

```tsx
<AxiomProvider
  config={{
    onBeforeSync: async (request) => {
      const token = await getFreshToken();
      return {
        ...request,
        headers: { ...request.headers, Authorization: `Bearer ${token}` }
      };
    }
  }}
>

```

---

## Contributing

We welcome contributions! Please feel free to submit a [Pull Request](https://www.google.com/search?q=https://github.com/jayethian/axiom/pulls) or report a [Bug](https://www.google.com/search?q=https://github.com/jayethian/axiom/issues).

## License

Distributed under the MIT License. See `LICENSE` for more information. Built with ⚡ by [Jayetheus](https://www.google.com/search?q=https://github.com/jayethian).