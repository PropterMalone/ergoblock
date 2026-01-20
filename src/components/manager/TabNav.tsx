import type { JSX } from 'preact';
import { currentTab, type TabType } from '../../signals/manager.js';

interface Tab {
  id: TabType;
  label: string;
}

const TABS: Tab[] = [
  { id: 'actions', label: 'Blocks & Mutes' },
  { id: 'amnesty', label: 'Amnesty' },
  { id: 'blocklist-audit', label: 'Blocklist Audit' },
  { id: 'repost-filters', label: 'Repost Filters' },
  { id: 'mass-ops', label: 'Mass Ops' },
  { id: 'copy-user', label: 'Copy User' },
  { id: 'settings', label: 'Settings' },
];

export function TabNav(): JSX.Element {
  const handleTabClick = (tabId: TabType) => {
    currentTab.value = tabId;
  };

  return (
    <div class="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          class={`tab ${currentTab.value === tab.id ? 'active' : ''}`}
          onClick={() => handleTabClick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
