import { useAxiomContext } from "./AxiomProvider";

export function useAxiomQueue() {
  const {
    isOnline,
    forceSync,
    deadLetters,
    clearDeadLetters,
    inspectQueue,
    cancelRequest,
    refreshDeadLetters,
  } = useAxiomContext();

  return {
    /** Boolean indicating if the device currently has an active connection */
    isOnline,
    /** Manually trigger the background sync manager */
    forceSync,
    /** Array of requests that failed permanently (exceeded max retries) */
    deadLetters,
    /** Clears the dead letter queue from the UI state */
    clearDeadLetters,
    /** Retrieves the current pending queue directly from storage */
    inspectQueue,
    /** Cancels and removes a specific request from the pending queue */
    cancelRequest,
    /** Reloads dead letters from persistent storage */
    refreshDeadLetters,
  };
}
