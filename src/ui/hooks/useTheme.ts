import { useEffect, useRef, useState } from 'preact/hooks';
import browser from '../../platform/browser.js';
import { getOptions } from '../../platform/storage.js';
import { STORAGE_KEYS } from '../../platform/storage/keys.js';
import { DEFAULT_OPTIONS, type ExtensionOptions } from '../../types.js';
import { createLogger } from '../../platform/utils.js';

type Theme = ExtensionOptions['theme'];
const log = createLogger('theme');
const savedThemes = new Map<symbol, Theme>();
const previews = new Map<symbol, Theme>();
let stopFollowingOS: (() => void) | undefined;

// One root writer and OS listener, with mounted settings previews above saved preferences.
function applyEffectiveTheme(): void {
  stopFollowingOS?.();
  stopFollowingOS = undefined;
  const themes = [...savedThemes.values(), ...previews.values()];
  const theme = themes[themes.length - 1];
  if (!theme) return;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => {
    const resolved = theme === 'auto' ? (media?.matches ? 'dark' : 'light') : theme;
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    root.classList.toggle('eb-dark', resolved === 'dark');
    root.classList.toggle('eb-light', resolved === 'light');
  };
  apply();
  if (theme === 'auto') {
    media?.addEventListener('change', apply);
    stopFollowingOS = () => media?.removeEventListener('change', apply);
  }
}

function useRootTheme(theme: Theme, preview: boolean): void {
  const owner = useRef(Symbol('theme owner'));
  useEffect(() => {
    const themes = preview ? previews : savedThemes;
    const key = owner.current;
    themes.set(key, theme);
    applyEffectiveTheme();
    return () => {
      themes.delete(key);
      applyEffectiveTheme();
    };
  }, [theme, preview]);
}

export function useTheme(theme: Theme): void {
  useRootTheme(theme, true);
}

export function useStoredTheme(): void {
  const [theme, setTheme] = useState<Theme>(DEFAULT_OPTIONS.theme);
  useRootTheme(theme, false);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      void getOptions()
        .then((options) => {
          if (active && current === request) setTheme(options.theme);
        })
        .catch((error: unknown) => log.error('Failed to load theme:', error));
    };
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && STORAGE_KEYS.OPTIONS in changes) load();
    };
    load();
    browser.storage.onChanged?.addListener(onChanged);
    return () => {
      active = false;
      browser.storage.onChanged?.removeListener(onChanged);
    };
  }, []);
}
