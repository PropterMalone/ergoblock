import { DEFAULT_OPTIONS, type ExtensionOptions } from './types.js';
import { getOptions, setOptions } from './storage.js';

// DOM elements
const defaultDurationSelect = document.getElementById('defaultDuration') as HTMLSelectElement;
const quickBlockDurationSelect = document.getElementById('quickBlockDuration') as HTMLSelectElement;
const notificationsEnabledCheckbox = document.getElementById(
  'notificationsEnabled'
) as HTMLInputElement;
const notificationSoundCheckbox = document.getElementById('notificationSound') as HTMLInputElement;
const showBadgeCountCheckbox = document.getElementById('showBadgeCount') as HTMLInputElement;
const checkIntervalRange = document.getElementById('checkInterval') as HTMLInputElement;
const intervalValueSpan = document.getElementById('intervalValue') as HTMLSpanElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

// Load and display current options
async function loadOptions(): Promise<void> {
  const options = await getOptions();

  defaultDurationSelect.value = options.defaultDuration.toString();
  quickBlockDurationSelect.value = options.quickBlockDuration.toString();
  notificationsEnabledCheckbox.checked = options.notificationsEnabled;
  notificationSoundCheckbox.checked = options.notificationSound;
  showBadgeCountCheckbox.checked = options.showBadgeCount;
  checkIntervalRange.value = options.checkInterval.toString();
  intervalValueSpan.textContent = options.checkInterval.toString();

  const themeRadio = document.querySelector(
    `input[name="theme"][value="${options.theme}"]`
  ) as HTMLInputElement;
  if (themeRadio) {
    themeRadio.checked = true;
  }
}

// Update interval value display
checkIntervalRange.addEventListener('input', () => {
  intervalValueSpan.textContent = checkIntervalRange.value;
});

// Save options
async function saveOptions(): Promise<void> {
  const selectedTheme =
    (document.querySelector('input[name="theme"]:checked') as HTMLInputElement)?.value || 'auto';

  const options: ExtensionOptions = {
    defaultDuration: parseInt(defaultDurationSelect.value, 10),
    quickBlockDuration: parseInt(quickBlockDurationSelect.value, 10),
    notificationsEnabled: notificationsEnabledCheckbox.checked,
    notificationSound: notificationSoundCheckbox.checked,
    showBadgeCount: showBadgeCountCheckbox.checked,
    checkInterval: parseInt(checkIntervalRange.value, 10),
    theme: selectedTheme as 'light' | 'dark' | 'auto',
  };

  await setOptions(options);
  showStatus('Settings saved successfully!', 'success');
}

// Reset to defaults
async function resetOptions(): Promise<void> {
  if (confirm('Reset all settings to defaults?')) {
    await setOptions(DEFAULT_OPTIONS);
    await loadOptions();
    showStatus('Settings reset to defaults', 'success');
  }
}

// Show status message
function showStatus(message: string, type: 'success' | 'error'): void {
  statusDiv.textContent = message;
  statusDiv.className = `status-message show ${type}`;

  setTimeout(() => {
    statusDiv.classList.remove('show');
  }, 3000);
}

// Event listeners
saveBtn.addEventListener('click', saveOptions);
resetBtn.addEventListener('click', resetOptions);

// Load options on page load
loadOptions().catch((error) => {
  console.error('[ErgoBlock] Failed to load options:', error);
  showStatus('Failed to load settings', 'error');
});
