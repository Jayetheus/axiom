import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { axiom } from '../engine/fetcher';
import { AxiomConfig, QueuedRequest } from '../types';
import { AxiomStorageAdapter } from '../adapters';

/**
 * Defines the state and methods exposed by the Axiom context to the React application.
 */
export interface AxiomContextType {
  /** Indicates whether the application currently has an active network connection. */
  isOnline: boolean;
  /** Manually triggers the background sync manager to attempt flushing the offline queue. */
  forceSync: () => Promise<void>;
  /** An array of requests that have permanently failed after exceeding their maximum retry limit. */
  deadLetters: QueuedRequest[];
  /** Clears the dead letter queue from the local UI state (does not affect persistent storage). */
  clearDeadLetters: () => void;
  /** Retrieves the current list of pending requests waiting in the offline queue. */
  inspectQueue: () => Promise<QueuedRequest[]>;
  /** Manually removes a specific request from the offline queue using its unique ID. */
  cancelRequest: (id: string) => Promise<void>;
}

// Default context initialization
const AxiomContext = createContext<AxiomContextType>({
  isOnline: true,
  forceSync: async () => {},
  deadLetters: [],
  clearDeadLetters: () => {},
  inspectQueue: async () => [],
  cancelRequest: async () => {},
});

/**
 * Configuration properties for the AxiomProvider.
 */
export interface AxiomProviderProps {
  /** The global configuration object for the Axiom engine (e.g., baseURL, timeout, maxRetries). */
  config: AxiomConfig;
  /** Optional: A custom storage adapter (e.g., MMKV, AsyncStorage) to override the default built-in adapters. */
  storageAdapter?: AxiomStorageAdapter;
  /** * Optional: Instructs the engine which built-in adapter to attempt to use if a custom one isn't provided.
   * Safely falls back to 'memory' if the chosen adapter is unsupported in the current environment. 
   */
  fallbackAdapter?: 'indexeddb' | 'localstorage' | 'memory';
  /** * Optional: A custom network listener function. Highly recommended for React Native (e.g., NetInfo.addEventListener). 
   * If omitted, Axiom safely falls back to standard Web APIs (window.addEventListener('online')). 
   */
  networkListener?: (callback: (isOnline: boolean) => void) => any;
  /** Your React application tree. */
  children: React.ReactNode;
}

/**
 * The root provider for the Axiom offline-first fetch wrapper.
 * * This component initializes the background engine, sets up network state listeners,
 * and provides the real-time queue state to the rest of your React application.
 * * @example
 * ```tsx
 * <AxiomProvider 
 * config={{ baseURL: '[https://api.example.com](https://api.example.com)', debug: true }}
 * fallbackAdapter="indexeddb"
 * >
 * <App />
 * </AxiomProvider>
 * ```
 */
export const AxiomProvider: React.FC<AxiomProviderProps> = ({ 
  config, 
  storageAdapter, 
  fallbackAdapter, 
  networkListener, 
  children 
}) => {
  const [isOnline, setIsOnline] = useState(true);
  const [deadLetters, setDeadLetters] = useState<QueuedRequest[]>([]);

  const enhancedConfig: AxiomConfig = {
    ...config,
    fallbackAdapter,
    onDeadLetter: (request, error) => {
      setDeadLetters(prev => [...prev, request]);
      if (config.onDeadLetter) config.onDeadLetter(request, error);
    }
  };

  useEffect(() => {
    axiom.create(enhancedConfig, storageAdapter);

    let unsubscribe: any;

    const handleNetworkChange = (status: boolean) => {
      setIsOnline(status);
      if (status) {
        axiom.forceSync();
      }
    };

    if (networkListener) {
      unsubscribe = networkListener(handleNetworkChange);
    } else if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      
      const goOnline = () => handleNetworkChange(true);
      const goOffline = () => handleNetworkChange(false);

      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);

      unsubscribe = () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [enhancedConfig, storageAdapter, networkListener]);

  const clearDeadLetters = useCallback(() => setDeadLetters([]), []);

  return (
    <AxiomContext.Provider value={{ 
      isOnline, 
      forceSync: () => axiom.forceSync(), 
      deadLetters, 
      clearDeadLetters,
      inspectQueue: () => axiom.getQueue(),
      cancelRequest: (id: string) => axiom.cancelRequest(id)
    }}>
      {children}
    </AxiomContext.Provider>
  );
};

/**
 * Hook to access the internal Axiom context directly.
 * @internal Developers should generally import `useAxiomQueue()` instead of this internal hook.
 */
export const useAxiomContext = () => useContext(AxiomContext);