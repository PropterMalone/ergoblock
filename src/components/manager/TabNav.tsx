import type { JSX } from 'preact';
import { currentTab, type TabType } from '../../signals/manager.js';
import { Tooltip } from '../shared/Tooltip.js';

type Tab = {
  id: TabType;
  label: string;
  tooltip: string;
};

const TABS: Tab[] = [
  {
    id: 'actions',
    label: 'Blocks & Mutes',
    tooltip: 'View and manage all your blocked and muted accounts',
  },
  {
    id: 'amnesty',
    label: 'Amnesty',
    tooltip: 'Review old blocks to decide if they should be removed',
  },
  {
    id: 'blocklist-audit',
    label: 'Blocklist Audit',
    tooltip: 'Check for conflicts between your follows and blocklist subscriptions',
  },
  {
    id: 'repost-filters',
    label: 'Repost Filters',
    tooltip: "Manage accounts whose reposts you've hidden from your feed",
  },
  {
    id: 'mass-ops',
    label: 'Mass Ops',
    tooltip: 'Detect and undo patterns of rapid automated blocking',
  },
  {
    id: 'copy-user',
    label: 'Copy User',
    tooltip: "Import another user's blocks or follows to your account",
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Configure ErgoBlock behavior and appearance',
  },
];

export function TabNav(): JSX.Element {
  const handleTabClick = (tabId: TabType) => {
    currentTab.value = tabId;
  };

  return (
    <div class="tabs">
      {TABS.map((tab) => (
        <Tooltip key={tab.id} text={tab.tooltip} position="bottom">
          <button
            class={`tab ${currentTab.value === tab.id ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
