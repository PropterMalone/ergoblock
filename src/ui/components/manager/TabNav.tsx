import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { currentTab, type TabType } from '../../signals/manager.js';

const PRIMARY: { id: TabType; label: string }[] = [
  { id: 'actions', label: 'Blocks & Mutes' },
  { id: 'quote-sweep', label: 'Post actions' },
  { id: 'settings', label: 'Settings' },
];
const ADVANCED: { id: TabType; label: string }[] = [
  { id: 'mass-ops', label: 'Mass Ops' },
  { id: 'copy-user', label: 'Copy User' },
];

export function TabNav(): JSX.Element {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const select = (id: TabType, primary: boolean) => {
    currentTab.value = id;
    if (primary && disclosure.current) disclosure.current.open = false;
  };
  const button = (tab: { id: TabType; label: string }, primary: boolean) => (
    <button
      key={tab.id}
      class={`tab ${currentTab.value === tab.id ? 'active' : ''}`}
      aria-pressed={currentTab.value === tab.id}
      onClick={() => select(tab.id, primary)}
    >
      {tab.label}
    </button>
  );
  return (
    <nav aria-label="Manager sections" class="tabs">
      {PRIMARY.map((tab) => button(tab, true))}
      <details
        ref={disclosure}
        class="advanced-tools"
        onToggle={(event) => {
          if (!event.currentTarget.open && ADVANCED.some((tab) => tab.id === currentTab.value)) {
            currentTab.value = 'actions';
          }
        }}
      >
        <summary>Advanced</summary>
        {ADVANCED.map((tab) => button(tab, false))}
      </details>
    </nav>
  );
}
