import { signal, computed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getActionHistory } from '../storage.js';
import type { HistoryEntry } from '../types.js';

// Global signals for history state
const history = signal<HistoryEntry[]>([]);
const loading = signal(true);
const error = signal<string | null>(null);

// Computed values
const count = computed(() => history.value.length);
const recentHistory = computed(() => history.value.slice(0, 5));
const blockHistory = computed(() => history.value.filter((h) => h.action === 'blocked'));
const unblockHistory = computed(() => history.value.filter((h) => h.action === 'unblocked'));
const muteHistory = computed(() => history.value.filter((h) => h.action === 'muted'));
const unmuteHistory = computed(() => history.value.filter((h) => h.action === 'unmuted'));

/**
 * Hook for managing action history
 */
export function useHistory() {
  useEffect(() => {
    loadHistory();
  }, []);

  return {
    history,
    loading,
    error,
    count,
    recentHistory,
    blockHistory,
    unblockHistory,
    muteHistory,
    unmuteHistory,
    refresh: loadHistory,
  };
}

async function loadHistory(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await getActionHistory();
    history.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load history';
  } finally {
    loading.value = false;
  }
}

export {
  history,
  loading,
  error,
  count,
  recentHistory,
  blockHistory,
  unblockHistory,
  muteHistory,
  unmuteHistory,
  loadHistory,
};
