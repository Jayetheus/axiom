import { AxiomStorageAdapter } from './index';
import { MemoryStorageAdapter } from './memory';
import { LocalStorageAdapter } from './localstorage';
import { IndexedDBStorageAdapter } from './indexeddb';

export type BuiltInAdapter = 'indexeddb' | 'localstorage' | 'memory';

/**
 * Intelligently resolves the best storage adapter based on the requested fallback
 * and the current runtime environment (Web vs React Native vs Node/SSR).
 * @param preference The developer's preferred fallback adapter.
 * @param debug Whether to log the resolution result.
 * @returns A safe, instantiated AxiomStorageAdapter.
 */
export function resolveStorageAdapter(preference: BuiltInAdapter, debug: boolean = false): AxiomStorageAdapter {
  const isBrowser = typeof window !== 'undefined';
  
  if (!isBrowser) {
    if (debug) console.log('[Axiom Debug] Non-browser environment detected (React Native/SSR). Defaulting to Memory adapter.');
    return new MemoryStorageAdapter();
  }

  if (preference === 'indexeddb' && window.indexedDB) {
    if (debug) console.log('[Axiom Debug] IndexedDB adapter initialized.');
    return new IndexedDBStorageAdapter();
  }

  if ((preference === 'localstorage' || preference === 'indexeddb') && window.localStorage) {
    if (debug) console.log(`[Axiom Debug] ${preference === 'indexeddb' ? 'IndexedDB unavailable. ' : ''}LocalStorage adapter initialized.`);
    return new LocalStorageAdapter();
  }

  if (debug) console.log('[Axiom Debug] No persistent browser storage available. Falling back to Memory adapter.');
  return new MemoryStorageAdapter();
}