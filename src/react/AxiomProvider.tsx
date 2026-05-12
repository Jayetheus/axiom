import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { axiom } from '../engine/fetcher';
import { AxiomConfig, QueuedRequest } from '../types';
import { AxiomStorageAdapter } from '../adapters';

interface AxiomContextType {
  isOnline: boolean;
  forceSync: () => Promise<void>;
  deadLetters: QueuedRequest[];
  clearDeadLetters: () => void;
}

const AxiomContext = createContext<AxiomContextType>({
  isOnline: true,
  forceSync: async () => {},
  deadLetters: [],
  clearDeadLetters: () => {},
});

export const AxiomProvider: React.FC<{
  config: AxiomConfig;
  storageAdapter?: AxiomStorageAdapter;
  /** Optional: Pass a custom listener for React Native (NetInfo). If omitted, defaults to Web APIs. */
  networkListener?: (callback: (isOnline: boolean) => void) => any;
  children: React.ReactNode;
}> = ({ config, storageAdapter, networkListener, children }) => {
  const [isOnline, setIsOnline] = useState(true);
  const [deadLetters, setDeadLetters] = useState<QueuedRequest[]>([]);

  const enhancedConfig: AxiomConfig = {
    ...config,
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
    <AxiomContext.Provider value={{ isOnline, forceSync: () => axiom.forceSync(), deadLetters, clearDeadLetters }}>
      {children}
    </AxiomContext.Provider>
  );
};

export const useAxiomContext = () => useContext(AxiomContext);