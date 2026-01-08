import { signal, computed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getAllManagedMutes } from '../storage.js';
import type { ManagedEntry } from '../types.js';

// Global signals for mutes state
const mutes = signal<ManagedEntry[]>([]);
const loading = signal(true);
const error = signal<string | null>(null);

// Computed values
const count = computed(() => mutes.value.length);
const tempMutes = computed(() => mutes.value.filter((m) => m.source === 'ergoblock_temp'));
const permanentMutes = computed(() => mutes.value.filter((m) => m.source !== 'ergoblock_temp'));
const expiringMutes = computed(() => {
  const now = Date.now();
  const next24h = now + 24 * 60 * 60 * 1000;
  return tempMutes.value.filter((m) => m.expiresAt && m.expiresAt <= next24h);
});

/**
 * Hook for managing mutes data
 */
export function useMutes() {
  useEffect(() => {
    loadMutes();
  }, []);

  return {
    mutes,
    loading,
    error,
    count,
    tempMutes,
    permanentMutes,
    expiringMutes,
    refresh: loadMutes,
  };
}

async function loadMutes(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await getAllManagedMutes();
    mutes.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load mutes';
  } finally {
    loading.value = false;
  }
}

export { mutes, loading, error, count, tempMutes, permanentMutes, expiringMutes, loadMutes };
