import React, { createContext, useContext, useEffect, useState } from 'react';
import { axiom } from '../engine/fetcher';
import { AxiomConfig } from '../types';
import { AxiomStorageAdapter } from '../adapters';

interface AxiomContextType {
  isOnline: boolean;
  forceSync: () => Promise<void>;
}

// Create a safe default context
const AxiomContext = createContext<AxiomContextType>({
  isOnline: true,
  forceSync: async () => {},
});

export const AxiomProvider: React.FC<{
  config: AxiomConfig;
  storageAdapter?: AxiomStorageAdapter;
  /** * A function that takes a callback, calls it whenever network state changes, 
   * and returns an unsubscribe function.
   */
  networkListener: (callback: (isOnline: boolean) => void) => any;
  children: React.ReactNode;
}> = ({ config, storageAdapter, networkListener, children }) => {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // 1. Boot up the Axiom engine
    axiom.create(config, storageAdapter);

    // 2. Attach the OS-level network listener
    const unsubscribe = networkListener((onlineStatus) => {
      setIsOnline(onlineStatus);
      
      // 3. The Magic: If the internet comes back, automatically flush the queue
      if (onlineStatus) {
        axiom.forceSync();
      }
    });

    // Cleanup listener on unmount
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [config, storageAdapter, networkListener]);

  return (
    <AxiomContext.Provider value={{ isOnline, forceSync: () => axiom.forceSync() }}>
      {children}
    </AxiomContext.Provider>
  );
};

export const useAxiomContext = () => useContext(AxiomContext);