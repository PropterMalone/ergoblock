import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { getOptions, setOptions } from './platform/storage.js';
import { DEFAULT_OPTIONS, type ExtensionOptions } from './types.js';
import { Tooltip } from './ui/components/shared/Tooltip.js';
import { SETTINGS_TOOLTIPS } from './ui/constants/tooltips.js';
import { KOFI_URL, SUPPORT_LABEL } from './ui/constants/support.js';
import { createLogger } from './platform/utils.js';
import {
  associateSettingControl,
  type SettingControlProps,
} from './ui/components/shared/SettingControl.js';
import { useId } from 'preact/hooks';
import { MIN_CHECK_INTERVAL, MAX_CHECK_INTERVAL } from './platform/check-interval.js';
import { useTheme } from './ui/hooks/useTheme.js';

const log = createLogger('options');

type Theme = 'light' | 'dark' | 'auto';

interface StatusState {
  message: string;
  type: 'success' | 'error';
}

const DURATION_OPTIONS = [
  { value: 3600000, label: '1 hour' },
  { value: 21600000, label: '6 hours' },
  { value: 43200000, label: '12 hours' },
  { value: 86400000, label: '24 hours' },
  { value: 259200000, label: '3 days' },
  { value: 604800000, label: '1 week' },
];

export function OptionsApp() {
  const [options, setLocalOptions] = useState<ExtensionOptions>(DEFAULT_OPTIONS);
  useTheme(options.theme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusState | null>(null);

  useEffect(() => {
    loadOptions();
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
      log.error('Failed to load options:', error);
      showStatus('Failed to load settings', 'error');
    } finally {
      setLoading(false);
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await setOptions(options);
      showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      log.error('Failed to save options:', error);
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
        showStatus('Settings reset to defaults', 'success');
      } catch (error) {
        log.error('Failed to reset options:', error);
        showStatus('Failed to reset settings', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  if (loading) {
    return (
      <div class="container">
        <div class="header">
          <h1>ErgoBlock Settings</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div class="container">
      <div class="header">
        <h1>ErgoBlock Settings</h1>
        <p>Customize how temporary blocks and mutes work</p>
      </div>

      {status && <div class={`status-message show ${status.type}`}>{status.message}</div>}

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

      <SettingsSection title="Notifications">
        <SettingRow
          label="Enable notifications"
          description="Get alerts when blocks and mutes expire"
        >
          <Checkbox
            id="notificationsEnabled"
            label="Notify me"
            checked={options.notificationsEnabled}
            onChange={(checked) => updateOption('notificationsEnabled', checked)}
          />
        </SettingRow>

        <SettingRow label="Notification sound" description="Play sound with notifications">
          <Checkbox
            id="notificationSound"
            label="Enable sound"
            checked={options.notificationSound}
            onChange={(checked) => updateOption('notificationSound', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Expiration Check">
        <SettingRow
          label="Check interval"
          tooltip={SETTINGS_TOOLTIPS.checkInterval}
          description="How often to check for expired blocks/mutes"
        >
          <RangeSlider
            id="checkInterval"
            min={MIN_CHECK_INTERVAL}
            max={MAX_CHECK_INTERVAL}
            value={options.checkInterval}
            unit="min"
            onChange={(value) => updateOption('checkInterval', value)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingRow label="Theme" description="Choose your color scheme">
          <ThemeSelector value={options.theme} onChange={(theme) => updateOption('theme', theme)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="QT Peek">
        <SettingRow
          label="Enable feature"
          description="Adds a right-click menu option to reveal blocked or detached quoted posts using the public API"
        >
          <Checkbox
            id="qtPeekEnabled"
            label="Enable 'Peek at quote' for hidden quotes"
            checked={options.qtPeekEnabled}
            onChange={(checked) => updateOption('qtPeekEnabled', checked)}
          />
        </SettingRow>
      </SettingsSection>

      <div class="button-group">
        <button class="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button class="btn-secondary" onClick={handleReset} disabled={saving}>
          Reset to Defaults
        </button>
      </div>

      <footer class="support-footer">
        <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
          {SUPPORT_LABEL}
        </a>
        <span class="support-footer__note">Free &amp; open source. Tips keep it maintained.</span>
      </footer>
    </div>
  );
}

// Sub-components

interface SettingsSectionProps {
  title: string;
  children: preact.ComponentChildren;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div class="settings-section">
      <div class="section-title">{title}</div>
      {children}
    </div>
  );
}

interface SettingRowProps {
  label: preact.ComponentChildren;
  description: string;
  children: preact.ComponentChildren;
  tooltip?: string;
}

function SettingRow({ label, description, children, tooltip }: SettingRowProps) {
  const id = useId();
  const labelElement = (
    <div id={`${id}-label`} class="setting-label">
      {label}
    </div>
  );
  return (
    <div class="setting-group">
      <div>
        {tooltip ? (
          <Tooltip text={tooltip} position="right">
            {labelElement}
          </Tooltip>
        ) : (
          labelElement
        )}
        <div id={`${id}-description`} class="setting-description">
          {description}
        </div>
      </div>
      <div class="setting-control">{associateSettingControl(children, id)}</div>
    </div>
  );
}

interface DurationSelectProps extends SettingControlProps {
  value: number;
  onChange: (value: number) => void;
}

function DurationSelect({ value, onChange, ...controlProps }: DurationSelectProps) {
  return (
    <select
      {...controlProps}
      value={value}
      onChange={(e) => onChange(parseInt((e.target as HTMLSelectElement).value, 10))}
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

function Checkbox({ id, label, checked, onChange }: CheckboxProps) {
  return (
    <div class="checkbox-group">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <label for={id}>{label}</label>
    </div>
  );
}

interface RangeSliderProps extends SettingControlProps {
  id: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}

function RangeSlider({ id, min, max, value, unit, onChange, ...controlProps }: RangeSliderProps) {
  return (
    <div class="slider-container">
      <input
        type="range"
        {...controlProps}
        id={id}
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value, 10))}
      />
      <div class="slider-value">
        <span>{value}</span> {unit}
      </div>
    </div>
  );
}

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const themes: { value: Theme; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div class="radio-group">
      {themes.map((theme) => (
        <label key={theme.value} class="radio-option">
          <input
            type="radio"
            name="theme"
            value={theme.value}
            checked={value === theme.value}
            onChange={() => onChange(theme.value)}
          />
          <span>{theme.label}</span>
        </label>
      ))}
    </div>
  );
}

// Mount the app
const root = document.getElementById('app');
if (root) {
  render(<OptionsApp />, root);
} else {
  // Fallback: render to body if no #app element
  const container = document.createElement('div');
  container.id = 'app';
  document.body.appendChild(container);
  render(<OptionsApp />, container);
}
