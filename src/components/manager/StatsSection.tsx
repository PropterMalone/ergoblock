import type { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { BarChart2, RefreshCw, RotateCcw } from 'lucide-preact';
import { getUsageStats, resetUsageStats } from '../../storage.js';
import type { UsageStats } from '../../types.js';

function formatDurationLabel(key: string): string {
  const labels: Record<string, string> = {
    hour1: '1 hour',
    hour6: '6 hours',
    hour12: '12 hours',
    hour24: '24 hours',
    day3: '3 days',
    week1: '1 week',
    longer: '> 1 week',
  };
  return labels[key] || key;
}

function StatCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div class="stat-card">
      <div class="stat-value">{value.toLocaleString()}</div>
      <div class="stat-label">{label}</div>
    </div>
  );
}

export function StatsSection(): JSX.Element {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    try {
      const s = await getUsageStats();
      setStats(s);
    } catch (err) {
      console.error('[StatsSection] Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleReset = async () => {
    if (confirm('Reset all usage statistics? This cannot be undone.')) {
      await resetUsageStats();
      await loadStats();
    }
  };

  if (loading) {
    return (
      <div class="stats-section">
        <h3>
          <BarChart2 size={18} /> Usage Statistics
        </h3>
        <div class="stats-loading">
          <RefreshCw size={16} class="spinner" /> Loading...
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div class="stats-section">
        <h3>
          <BarChart2 size={18} /> Usage Statistics
        </h3>
        <p>Failed to load statistics</p>
      </div>
    );
  }

  // Calculate max for duration bar widths
  const durationValues = Object.values(stats.blocksByDuration);
  const maxDuration = Math.max(...durationValues, 1);

  return (
    <div class="stats-section">
      <h3>
        <BarChart2 size={18} /> Usage Statistics
      </h3>

      <div class="stats-grid">
        <div class="stats-group">
          <h4>Blocks</h4>
          <StatCard label="Total Created" value={stats.totalBlocksCreated} />
          <StatCard label="Temporary" value={stats.tempBlocksCreated} />
          <StatCard label="Permanent" value={stats.permanentBlocksCreated} />
          <StatCard label="Auto-Expired" value={stats.blocksAutoExpired} />
          <StatCard label="Manually Removed" value={stats.blocksManuallyRemoved} />
        </div>

        <div class="stats-group">
          <h4>Mutes</h4>
          <StatCard label="Total Created" value={stats.totalMutesCreated} />
          <StatCard label="Temporary" value={stats.tempMutesCreated} />
          <StatCard label="Permanent" value={stats.permanentMutesCreated} />
          <StatCard label="Auto-Expired" value={stats.mutesAutoExpired} />
          <StatCard label="Manually Removed" value={stats.mutesManuallyRemoved} />
        </div>

        <div class="stats-group">
          <h4>Features</h4>
          <StatCard label="Amnesty Reviews" value={stats.amnestyReviews} />
          <StatCard label="Amnesty Unblocks" value={stats.amnestyUnblocks} />
          <StatCard label="Imports" value={stats.importsPerformed} />
        </div>
      </div>

      <div class="stats-duration-section">
        <h4>Blocks by Duration</h4>
        <div class="duration-bars">
          {Object.entries(stats.blocksByDuration).map(([key, value]) => (
            <div class="duration-bar-row" key={key}>
              <span class="duration-label">{formatDurationLabel(key)}</span>
              <div class="duration-bar-container">
                <div
                  class="duration-bar"
                  style={{ width: `${Math.max((value / maxDuration) * 100, value > 0 ? 2 : 0)}%` }}
                />
              </div>
              <span class="duration-value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="stats-footer">
        <span class="stats-tracking-since">
          Tracking since:{' '}
          {stats.statsResetAt ? new Date(stats.statsResetAt).toLocaleDateString() : 'Unknown'}
        </span>
        <button class="stats-reset-btn" onClick={handleReset}>
          <RotateCcw size={14} /> Reset Stats
        </button>
      </div>
    </div>
  );
}
