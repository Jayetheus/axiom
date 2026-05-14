import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { axiom } from "../engine/fetcher";
import type { AxiomConfig, AxiomStorageAdapter, QueuedRequest } from "../types";

export interface AxiomContextType {
  isOnline: boolean;
  forceSync: () => Promise<void>;
  deadLetters: QueuedRequest[];
  clearDeadLetters: () => Promise<void>;
  inspectQueue: () => Promise<QueuedRequest[]>;
  cancelRequest: (id: string) => Promise<void>;
  refreshDeadLetters: () => Promise<void>;
}

const AxiomContext = createContext<AxiomContextType>({
  isOnline: true,
  forceSync: async () => {},
  deadLetters: [],
  clearDeadLetters: async () => {},
  inspectQueue: async () => [],
  cancelRequest: async () => {},
  refreshDeadLetters: async () => {},
});

export interface AxiomProviderProps {
  config: AxiomConfig;
  storageAdapter?: AxiomStorageAdapter;
  fallbackAdapter?: "indexeddb" | "localstorage" | "memory";
  networkListener?: (
    callback: (isOnline: boolean) => void,
  ) => void | (() => void) | { remove?: () => void };
  children: React.ReactNode;
}

export const AxiomProvider: React.FC<AxiomProviderProps> = ({
  config,
  storageAdapter,
  fallbackAdapter,
  networkListener,
  children,
}) => {
  const [isOnline, setIsOnline] = useState(true);
  const [deadLetters, setDeadLetters] = useState<QueuedRequest[]>([]);

  const refreshDeadLetters = useCallback(async () => {
    const persisted = await axiom.getDeadLetters();
    setDeadLetters(persisted);
  }, []);

  const enhancedConfig: AxiomConfig = useMemo(
    () => ({
      ...config,
      fallbackAdapter,
      onDeadLetter: async (request, error) => {
        await config.onDeadLetter?.(request, error);
        await refreshDeadLetters();
      },
    }),
    [config, fallbackAdapter, refreshDeadLetters],
  );

  useEffect(() => {
    axiom.create(enhancedConfig, storageAdapter);
    void refreshDeadLetters();
  }, [fallbackAdapter, storageAdapter, refreshDeadLetters]);

  useEffect(() => {
    axiom.updateConfig(enhancedConfig);
  }, [enhancedConfig]);

  useEffect(() => {
    let cleanup: undefined | (() => void);

    const handleNetworkChange = (status: boolean) => {
      setIsOnline(status);
      axiom.setOnlineStatus(status);
    };

    if (networkListener) {
      const subscription = networkListener(handleNetworkChange);

      if (typeof subscription === "function") {
        cleanup = subscription;
      } else if (subscription && typeof subscription.remove === "function") {
        cleanup = () => subscription.remove?.();
      }
    } else if (typeof window !== "undefined") {
      const goOnline = () => handleNetworkChange(true);
      const goOffline = () => handleNetworkChange(false);

      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
      handleNetworkChange(window.navigator.onLine);

      cleanup = () => {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      };
    }

    return () => cleanup?.();
  }, [networkListener]);

  const clearDeadLetters = useCallback(async () => {
    await axiom.clearDeadLetters();
    setDeadLetters([]);
  }, []);

  const contextValue = useMemo(
    () => ({
      isOnline,
      forceSync: () => axiom.forceSync(),
      deadLetters,
      clearDeadLetters,
      inspectQueue: () => axiom.getQueue(),
      cancelRequest: (id: string) => axiom.cancelRequest(id),
      refreshDeadLetters,
    }),
    [isOnline, deadLetters, clearDeadLetters, refreshDeadLetters],
  );

  return (
    <AxiomContext.Provider value={contextValue}>
      {children}
    </AxiomContext.Provider>
  );
};

export const useAxiomContext = () => useContext(AxiomContext);
