import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { send } from '../../../platform/messages.js';

export function SetExpiration({
  did,
  actionType,
  onReload,
}: {
  did: string;
  actionType: 'block' | 'mute';
  onReload: () => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(604800000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await send('ASSIGN_DURATION_TO_PERMANENT', { did, actionType, duration });
      if (!result.success) throw new Error(result.error || 'Could not set expiration');
      await onReload();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not set expiration');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="set-expiration">
      <button class="action-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Set {actionType} expiration
      </button>
      {open && (
        <div>
          <label>
            Expire {actionType} in{' '}
            <select
              value={duration}
              disabled={busy}
              onChange={(event) => setDuration(Number(event.currentTarget.value))}
            >
              <option value={3600000}>1 hour</option>
              <option value={86400000}>1 day</option>
              <option value={604800000}>1 week</option>
              <option value={2592000000}>1 month</option>
            </select>
          </label>
          <button class="action-btn" disabled={busy} onClick={save}>
            {busy ? 'Saving...' : 'Set expiration'}
          </button>
          <button class="action-btn" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
