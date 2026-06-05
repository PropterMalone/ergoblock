import type { JSX } from 'preact';
import { stats } from '../../signals/manager.js';

export function StatsBar(): JSX.Element {
  const s = stats.value;

  return (
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-value">{s.totalBlocks}</div>
        <div class="stat-label">Total Blocks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{s.totalMutes}</div>
        <div class="stat-label">Total Mutes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{s.tempBlocks}</div>
        <div class="stat-label">Temp Blocks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{s.tempMutes}</div>
        <div class="stat-label">Temp Mutes</div>
      </div>
    </div>
  );
}
