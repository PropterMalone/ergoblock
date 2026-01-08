import { signal, computed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { getOptions, setOptions } from '../storage.js';
import { DEFAULT_OPTIONS, type ExtensionOptions } from '../types.js';

// Global signals for options state
const options = signal<ExtensionOptions>(DEFAULT_OPTIONS);
const loading = signal(true);
const saving = signal(false);
const error = signal<string | null>(null);

// Computed for convenience
const isLoaded = computed(() => !loading.value);

/**
 * Hook for managing extension options
 */
export function useOptions() {
  useEffect(() => {
    loadOptions();
  }, []);

  return {
    options,
    loading,
    saving,
    error,
    isLoaded,
    refresh: loadOptions,
    save: saveOptions,
    update: updateOption,
  };
}

async function loadOptions(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const loaded = await getOptions();
    options.value = loaded;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load options';
  } finally {
    loading.value = false;
  }
}

async function saveOptions(): Promise<boolean> {
  saving.value = true;
  error.value = null;
  try {
    await setOptions(options.value);
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save options';
    return false;
  } finally {
    saving.value = false;
  }
}

function updateOption<K extends keyof ExtensionOptions>(key: K, value: ExtensionOptions[K]): void {
  options.value = { ...options.value, [key]: value };
}

export { options, loading, saving, error, isLoaded, loadOptions, saveOptions, updateOption };
