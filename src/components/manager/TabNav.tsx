import type { JSX } from 'preact';
import { currentTab, type TabType } from '../../signals/manager.js';
import { Tooltip } from '../shared/Tooltip.js';

type TabGroup = 'core' | 'review' | 'advanced' | 'config';

type Tab = {
  id: TabType;
  label: string;
  tooltip: string;
  group: TabGroup;
};

const TABS: Tab[] = [
  {
    id: 'actions',
    label: 'Blocks & Mutes',
    tooltip: 'View and manage all your blocked and muted accounts',
    group: 'core',
  },
  {
    id: 'amnesty',
    label: 'Amnesty',
    tooltip: 'Review old blocks to decide if they should be removed',
    group: 'review',
  },
  {
    id: 'blocklist-audit',
    label: 'Blocklist Audit',
    tooltip: 'Check for conflicts between your follows and blocklist subscriptions',
    group: 'review',
  },
  {
    id: 'repost-filters',
    label: 'Repost Filters',
    tooltip: "Manage accounts whose reposts you've hidden from your feed",
    group: 'advanced',
  },
  {
    id: 'mass-ops',
    label: 'Mass Ops',
    tooltip: 'Detect and undo patterns of rapid automated blocking',
    group: 'advanced',
  },
  {
    id: 'copy-user',
    label: 'Copy User',
    tooltip: "Import another user's blocks or follows to your account",
    group: 'advanced',
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Configure ErgoBlock behavior and appearance',
    group: 'config',
  },
];

export function TabNav(): JSX.Element {
  const handleTabClick = (tabId: TabType) => {
    currentTab.value = tabId;
  };

  return (
    <div class="tabs">
      {TABS.map((tab, index) => {
        const prevTab = TABS[index - 1];
        const isGroupStart = index === 0 || prevTab?.group !== tab.group;

        return (
          <Tooltip key={tab.id} text={tab.tooltip} position="bottom">
            <button
              class={`tab ${currentTab.value === tab.id ? 'active' : ''}`}
              data-group={tab.group}
              data-group-start={isGroupStart ? 'true' : undefined}
              onClick={() => handleTabClick(tab.id)}
            >
              {tab.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
