import { useAxiomContext } from './AxiomProvider';

export function useAxiomQueue() {
  const { isOnline, forceSync } = useAxiomContext();

  return {
    /** Boolean indicating if the device currently has an active connection */
    isOnline,
    /** Manually trigger the background sync manager */
    forceSync,
  };
}