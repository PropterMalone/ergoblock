import type { JSX } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { Settings, RefreshCw, Save, RotateCcw, Trash2, Search, AlertCircle, Database } from 'lucide-preact';
import { getOptions, setOptions, getColumnVisibility, setColumnVisibility } from '../../storage.js';
import {
  DEFAULT_OPTIONS,
  DEFAULT_COLUMN_VISIBILITY,
  COLUMN_METADATA,
  type ExtensionOptions,
  type ColumnVisibility,
  type TableColumn,
} from '../../types.js';
import browser from '../../browser.js';

type Theme = 'light' | 'dark' | 'auto';

interface StatusState {
  message: string;
  type: 'success' | 'error';
}

interface SettingsTabProps {
  onReload: () => Promise<void>;
}

const DURATION_OPTIONS = [
  { value: 3600000, label: '1 hour' },
  { value: 21600000, label: '6 hours' },
  { value: 43200000, label: '12 hours' },
  { value: 86400000, label: '24 hours' },
  { value: 259200000, label: '3 days' },
  { value: 604800000, label: '1 week' },
];

export function SettingsTab({ onReload }: SettingsTabProps): JSX.Element {
  const [options, setLocalOptions] = useState<ExtensionOptions>(DEFAULT_OPTIONS);
  const [columnVisibility, setColumnVisibilityState] = useState<ColumnVisibility>(
    DEFAULT_COLUMN_VISIBILITY
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusState | null>(null);

  useEffect(() => {
    loadOptions();
    loadColumnVisibility();
  }, []);

  useEffect(() => {
    if (status) {
      const timer = setTimeout(() => setStatus(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const loadOptions = async () => {
    try {
      const loaded = await getOptions();
      setLocalOptions(loaded);
    } catch (error) {
      console.error('[SettingsTab] Failed to load options:', error);
      showStatus('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadColumnVisibility = async () => {
    try {
      const visibility = await getColumnVisibility();
      setColumnVisibilityState(visibility);
    } catch (error) {
      console.error('[SettingsTab] Failed to load column visibility:', error);
    }
  };

  const showStatus = (message: string, type: 'success' | 'error') => {
    setStatus({ message, type });
  };

  const updateOption = useCallback(
    <K extends keyof ExtensionOptions>(key: K, value: ExtensionOptions[K]) => {
      setLocalOptions((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleColumnToggle = async (column: TableColumn) => {
    if (COLUMN_METADATA[column].alwaysVisible) return;

    const newValue = !columnVisibility[column];
    const updated = { ...columnVisibility, [column]: newValue };
    setColumnVisibilityState(updated);
    await setColumnVisibility(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setOptions(options);
      await onReload();
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      console.error('[SettingsTab] Failed to save options:', error);
      showStatus('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (confirm('Reset all settings to defaults?')) {
      setSaving(true);
      try {
        await setOptions(DEFAULT_OPTIONS);
        setLocalOptions(DEFAULT_OPTIONS);
        await onReload();
        showStatus('Settings reset to defaults', 'success');
      } catch (error) {
        console.error('[SettingsTab] Failed to reset options:', error);
        showStatus('Failed to reset settings', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  if (loading) {
    return (
      <div class="blocklist-audit-container">
        <div class="blocklist-audit-empty">
          <RefreshCw size={24} class="spinner" />
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div class="blocklist-audit-container">
      {/* Header */}
      <div class="blocklist-audit-header">
        <div class="blocklist-audit-stats">
          <div class="audit-stat">
            <Settings size={24} style={{ marginBottom: '4px', color: '#666' }} />
            <div class="audit-stat-label">Extension Settings</div>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {status && (
        <div
          class={`settings-status-message ${status.type}`}
          style={{
            padding: '8px 12px',
            marginBottom: '16px',
            borderRadius: '6px',
            backgroundColor: status.type === 'success' ? '#d4edda' : '#f8d7da',
            color: status.type === 'success' ? '#155724' : '#721c24',
            border: `1px solid ${status.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
          }}
        >
          {status.message}
        </div>
      )}

      {/* Settings Sections */}
      <div
        class="settings-sections"
        style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
      >
        {/* Default Duration */}
        <SettingsSection title="Default Duration">
          <SettingRow
            label="Default block/mute duration"
            description="How long blocks and mutes last by default"
          >
            <DurationSelect
              value={options.defaultDuration}
              onChange={(value) => updateOption('defaultDuration', value)}
            />
          </SettingRow>

          <SettingRow
            label="Quick block duration"
            description="Skip the dialog and use this duration"
          >
            <DurationSelect
              value={options.quickBlockDuration}
              onChange={(value) => updateOption('quickBlockDuration', value)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection title="Notifications">
          <SettingRow
            label="Enable notifications"
            description="Get alerts when blocks and mutes expire"
          >
            <Checkbox
              id="settings-notificationsEnabled"
              label="Notify me"
              checked={options.notificationsEnabled}
              onChange={(checked) => updateOption('notificationsEnabled', checked)}
            />
          </SettingRow>

          <SettingRow label="Notification sound" description="Play sound with notifications">
            <Checkbox
              id="settings-notificationSound"
              label="Enable sound"
              checked={options.notificationSound}
              onChange={(checked) => updateOption('notificationSound', checked)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Expiration Check */}
        <SettingsSection title="Expiration Check">
          <SettingRow
            label="Check interval"
            description="How often to check for expired blocks/mutes"
          >
            <IntervalSelect
              value={options.checkInterval}
              onChange={(value) => updateOption('checkInterval', value)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Appearance */}
        <SettingsSection title="Appearance">
          <SettingRow label="Theme" description="Choose your color scheme">
            <ThemeSelector
              value={options.theme}
              onChange={(theme) => updateOption('theme', theme)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Table Columns */}
        <SettingsSection title="Table Columns">
          <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary, #666)' }}>
            Choose which columns to show in the Blocks & Mutes table. Hiding columns can make the
            table easier to read.
          </div>
          <div class="column-visibility-options">
            {(Object.keys(COLUMN_METADATA) as Array<TableColumn>).map((column) => {
              const meta = COLUMN_METADATA[column];
              const isChecked = columnVisibility[column];
              const isDisabled = meta.alwaysVisible === true;

              return (
                <label key={column} class={`column-toggle ${isDisabled ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => handleColumnToggle(column)}
                  />
                  <span class="column-label">{meta.label}</span>
                  <span class="column-description">{meta.description}</span>
                </label>
              );
            })}
          </div>
        </SettingsSection>

        {/* Post Context */}
        <SettingsSection title="Post Context">
          <SettingRow
            label="Save post context"
            description="Remember the post that triggered a block/mute"
          >
            <Checkbox
              id="settings-savePostContext"
              label="Save context"
              checked={options.savePostContext}
              onChange={(checked) => updateOption('savePostContext', checked)}
            />
          </SettingRow>

          <SettingRow
            label="Context retention"
            description="How long to keep post context (0 = forever)"
          >
            <NumberInput
              id="settings-postContextRetentionDays"
              value={options.postContextRetentionDays}
              min={0}
              max={365}
              unit="days"
              onChange={(value) => updateOption('postContextRetentionDays', value)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Amnesty */}
        <SettingsSection title="Amnesty">
          <SettingRow
            label="Forgiveness period"
            description="How old a block must be to appear in Amnesty review"
          >
            <NumberInput
              id="settings-forgivenessPeriodDays"
              value={options.forgivenessPeriodDays}
              min={1}
              max={365}
              unit="days"
              onChange={(value) => updateOption('forgivenessPeriodDays', value)}
            />
          </SettingRow>
        </SettingsSection>

        {/* Last Word */}
        <SettingsSection title="Last Word">
          <SettingRow
            label="Default delay"
            description="How long to wait before blocking when using Last Word"
          >
            <NumberInput
              id="settings-lastWordDelaySeconds"
              value={options.lastWordDelaySeconds}
              min={10}
              max={3600}
              unit="seconds"
              onChange={(value) => updateOption('lastWordDelaySeconds', value)}
            />
          </SettingRow>

          <SettingRow
            label="Mute during delay"
            description="Mute the user while waiting, then unmute after blocking"
          >
            <Checkbox
              id="settings-lastWordMuteEnabled"
              label="Mute first"
              checked={options.lastWordMuteEnabled}
              onChange={(checked) => updateOption('lastWordMuteEnabled', checked)}
            />
          </SettingRow>
        </SettingsSection>

        {/* PDS Cleanup */}
        <PdsCleanupSection />

        {/* PDS Record Counts */}
        <PdsRecordCountsSection />
      </div>

      {/* Action Buttons */}
      <div
        class="settings-actions"
        style={{
          display: 'flex',
          gap: '12px',
          marginTop: '24px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border-color, #ddd)',
        }}
      >
        <button
          class="blocklist-action-btn primary"
          onClick={handleSave}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {saving ? <RefreshCw size={14} class="spinner" /> : <Save size={14} />}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          class="blocklist-action-btn"
          onClick={handleReset}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RotateCcw size={14} />
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

// Sub-components

interface SettingsSectionProps {
  title: string;
  children: preact.ComponentChildren;
}

function SettingsSection({ title, children }: SettingsSectionProps): JSX.Element {
  return (
    <div
      class="settings-section"
      style={{
        backgroundColor: 'var(--card-bg, #f9f9f9)',
        borderRadius: '8px',
        padding: '16px',
        border: '1px solid var(--border-color, #e0e0e0)',
      }}
    >
      <div
        class="settings-section-title"
        style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary, #333)',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border-color, #e0e0e0)',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>{children}</div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description: string;
  children: preact.ComponentChildren;
}

function SettingRow({ label, description, children }: SettingRowProps): JSX.Element {
  return (
    <div
      class="setting-row"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary, #333)' }}>
          {label}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary, #666)', marginTop: '2px' }}>
          {description}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

interface DurationSelectProps {
  value: number;
  onChange: (value: number) => void;
}

function DurationSelect({ value, onChange }: DurationSelectProps): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt((e.target as HTMLSelectElement).value, 10))}
      style={{
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid var(--border-color, #ccc)',
        backgroundColor: 'var(--input-bg, #fff)',
        color: 'var(--text-primary, #333)',
        fontSize: '13px',
        minWidth: '120px',
      }}
    >
      {DURATION_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface CheckboxProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Checkbox({ id, label, checked, onChange }: CheckboxProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
      />
      <label
        for={id}
        style={{ fontSize: '13px', color: 'var(--text-primary, #333)', cursor: 'pointer' }}
      >
        {label}
      </label>
    </div>
  );
}

interface RangeSliderProps {
  id: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RangeSlider({ id, min, max, value, unit, onChange }: RangeSliderProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value, 10))}
        style={{ width: '100px', cursor: 'pointer' }}
      />
      <span style={{ fontSize: '13px', color: 'var(--text-primary, #333)', minWidth: '50px' }}>
        {value} {unit}
      </span>
    </div>
  );
}

const CHECK_INTERVAL_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 360, label: '6 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

interface IntervalSelectProps {
  value: number;
  onChange: (value: number) => void;
}

function IntervalSelect({ value, onChange }: IntervalSelectProps): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt((e.target as HTMLSelectElement).value, 10))}
      style={{
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid var(--border-color, #ccc)',
        backgroundColor: 'var(--input-bg, #fff)',
        color: 'var(--text-primary, #333)',
        fontSize: '13px',
        minWidth: '120px',
      }}
    >
      {CHECK_INTERVAL_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface NumberInputProps {
  id: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

function NumberInput({ id, value, min, max, unit, onChange }: NumberInputProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        type="number"
        id={id}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(val) && val >= min && val <= max) {
            onChange(val);
          }
        }}
        style={{
          width: '70px',
          padding: '6px 10px',
          borderRadius: '6px',
          border: '1px solid var(--border-color, #ccc)',
          backgroundColor: 'var(--input-bg, #fff)',
          color: 'var(--text-primary, #333)',
          fontSize: '13px',
        }}
      />
      <span style={{ fontSize: '13px', color: 'var(--text-secondary, #666)' }}>{unit}</span>
    </div>
  );
}

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

function ThemeSelector({ value, onChange }: ThemeSelectorProps): JSX.Element {
  const themes: { value: Theme; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      {themes.map((theme) => (
        <label
          key={theme.value}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: 'var(--text-primary, #333)',
            cursor: 'pointer',
          }}
        >
          <input
            type="radio"
            name="settings-theme"
            value={theme.value}
            checked={value === theme.value}
            onChange={() => onChange(theme.value)}
            style={{ cursor: 'pointer' }}
          />
          <span>{theme.label}</span>
        </label>
      ))}
    </div>
  );
}

// PDS Cleanup Section
interface DuplicateScanResult {
  success: boolean;
  error?: string;
  totalRecords?: number;
  uniqueFollows?: number;
  duplicateDids?: number;
  duplicateRecords?: number;
  deleted?: number;
  deleteFailed?: number;
  duplicateDetails?: Array<{ did: string; count: number; uris: string[] }>;
}

function PdsCleanupSection(): JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scanResult, setScanResult] = useState<DuplicateScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'SCAN_DUPLICATE_FOLLOWS',
        deleteDuplicates: false,
      })) as DuplicateScanResult;

      if (!result.success) {
        setError(result.error || 'Scan failed');
      } else {
        setScanResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan');
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async () => {
    if (!scanResult || scanResult.duplicateRecords === 0) return;

    const confirmed = confirm(
      `This will delete ${scanResult.duplicateRecords} duplicate follow records from your PDS. ` +
        `The oldest record for each followed user will be kept.\n\nContinue?`
    );

    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      const result = (await browser.runtime.sendMessage({
        type: 'SCAN_DUPLICATE_FOLLOWS',
        deleteDuplicates: true,
      })) as DuplicateScanResult;

      if (!result.success) {
        setError(result.error || 'Delete failed');
      } else {
        setScanResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete duplicates');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      class="settings-section"
      style={{
        backgroundColor: 'var(--card-bg, #f9f9f9)',
        borderRadius: '8px',
        padding: '16px',
        border: '1px solid var(--border-color, #e0e0e0)',
      }}
    >
      <div
        class="settings-section-title"
        style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary, #333)',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border-color, #e0e0e0)',
        }}
      >
        PDS Cleanup
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary, #666)' }}>
          Scan your PDS for duplicate follow records. These can occur when following users through
          different tools or during sync issues.
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {scanResult && (
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--input-bg, #fff)',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #ddd)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-secondary, #666)' }}>Total records: </span>
                <strong>{scanResult.totalRecords}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary, #666)' }}>Unique follows: </span>
                <strong>{scanResult.uniqueFollows}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary, #666)' }}>Users with dupes: </span>
                <strong style={{ color: scanResult.duplicateDids ? '#dc3545' : 'inherit' }}>
                  {scanResult.duplicateDids}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary, #666)' }}>Extra records: </span>
                <strong style={{ color: scanResult.duplicateRecords ? '#dc3545' : 'inherit' }}>
                  {scanResult.duplicateRecords}
                </strong>
              </div>
            </div>

            {scanResult.deleted !== undefined && (
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-color, #ddd)',
                  fontSize: '13px',
                  color: '#155724',
                }}
              >
                Deleted {scanResult.deleted} duplicate records
                {scanResult.deleteFailed ? ` (${scanResult.deleteFailed} failed)` : ''}
              </div>
            )}

            {scanResult.duplicateRecords === 0 && scanResult.deleted === undefined && (
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-color, #ddd)',
                  fontSize: '13px',
                  color: '#155724',
                }}
              >
                No duplicates found - your PDS is clean!
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <button
            class="blocklist-action-btn"
            onClick={handleScan}
            disabled={scanning || deleting}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {scanning ? <RefreshCw size={14} class="spinner" /> : <Search size={14} />}
            {scanning ? 'Scanning...' : 'Scan for Duplicates'}
          </button>

          {scanResult && scanResult.duplicateRecords !== undefined && scanResult.duplicateRecords > 0 && scanResult.deleted === undefined && (
            <button
              class="blocklist-action-btn"
              onClick={handleDelete}
              disabled={scanning || deleting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#dc3545',
                color: 'white',
                borderColor: '#dc3545',
              }}
            >
              {deleting ? <RefreshCw size={14} class="spinner" /> : <Trash2 size={14} />}
              {deleting ? 'Deleting...' : `Delete ${scanResult.duplicateRecords} Duplicates`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// PDS Record Counts Section
interface RecordCountsResult {
  success: boolean;
  error?: string;
  collections?: Array<{ id: string; label: string; count: number }>;
}

function PdsRecordCountsSection(): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecordCountsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_PDS_RECORD_COUNTS',
      })) as RecordCountsResult;

      if (!response.success) {
        setError(response.error || 'Failed to fetch counts');
      } else {
        setResult(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch counts');
    } finally {
      setLoading(false);
    }
  };

  const formatCount = (count: number): string => {
    if (count === -1) return 'Error';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div
      class="settings-section"
      style={{
        backgroundColor: 'var(--card-bg, #f9f9f9)',
        borderRadius: '8px',
        padding: '16px',
        border: '1px solid var(--border-color, #e0e0e0)',
      }}
    >
      <div
        class="settings-section-title"
        style={{
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary, #333)',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border-color, #e0e0e0)',
        }}
      >
        PDS Record Counts
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary, #666)' }}>
          View the number of records in each collection of your Personal Data Server.
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {result && result.collections && (
          <div
            style={{
              padding: '12px',
              backgroundColor: 'var(--input-bg, #fff)',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #ddd)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                fontSize: '13px',
              }}
            >
              {result.collections.map((col) => (
                <div key={col.id}>
                  <span style={{ color: 'var(--text-secondary, #666)' }}>{col.label}: </span>
                  <strong style={{ color: col.count === -1 ? '#dc3545' : 'inherit' }}>
                    {formatCount(col.count)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <button
            class="blocklist-action-btn"
            onClick={handleFetch}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {loading ? <RefreshCw size={14} class="spinner" /> : <Database size={14} />}
            {loading ? 'Counting...' : 'Fetch Record Counts'}
          </button>
        </div>
      </div>
    </div>
  );
}
