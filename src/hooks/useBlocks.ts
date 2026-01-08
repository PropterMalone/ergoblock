import { signal, computed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getAllManagedBlocks } from '../storage.js';
import type { ManagedEntry } from '../types.js';

// Global signals for blocks state
const blocks = signal<ManagedEntry[]>([]);
const loading = signal(true);
const error = signal<string | null>(null);

// Computed values
const count = computed(() => blocks.value.length);
const tempBlocks = computed(() => blocks.value.filter((b) => b.source === 'ergoblock_temp'));
const permanentBlocks = computed(() => blocks.value.filter((b) => b.source !== 'ergoblock_temp'));
const expiringBlocks = computed(() => {
  const now = Date.now();
  const next24h = now + 24 * 60 * 60 * 1000;
  return tempBlocks.value.filter((b) => b.expiresAt && b.expiresAt <= next24h);
});

/**
 * Hook for managing blocks data
 */
export function useBlocks() {
  useEffect(() => {
    loadBlocks();
  }, []);

  return {
    blocks,
    loading,
    error,
    count,
    tempBlocks,
    permanentBlocks,
    expiringBlocks,
    refresh: loadBlocks,
  };
}

async function loadBlocks(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await getAllManagedBlocks();
    blocks.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load blocks';
  } finally {
    loading.value = false;
  }
}

export { blocks, loading, error, count, tempBlocks, permanentBlocks, expiringBlocks, loadBlocks };
