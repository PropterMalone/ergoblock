import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import browser from './platform/browser.js';
import { send } from './platform/messages.js';
import {
  getTempBlocks,
  getTempMutes,
  getPermanentBlocks,
  getPermanentMutes,
  removeTempBlock,
  removeTempMute,
  removePermanentBlock,
  removePermanentMute,
} from './platform/storage.js';
import { Mark, Wordmark, Btn, Icon } from './ui/components/shared/index.js';
import { createLogger } from './platform/utils.js';

const log = createLogger('popup');

interface ProfileData {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

interface ExistingAction {
  type: 'block' | 'mute';
  isPermanent: boolean;
  expiresAt?: number;
  createdAt?: number;
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'no-auth' }
  | { kind: 'no-profile' }
  | { kind: 'action'; profile: ProfileData; existing: ExistingAction | null };

type ActionTab = 'block' | 'mute';
type DurationId = '1h' | '24h' | '7d' | '30d' | 'perm';

interface DurationOpt {
  id: DurationId;
  label: string;
  ms: number; // 0 for perm
}

const DURATIONS: DurationOpt[] = [
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'perm', label: 'Permanent', ms: 0 },
];

const screen = signal<Screen>({ kind: 'loading' });
const actionTab = signal<ActionTab>('block');
const durationSel = signal<DurationId>('7d');
const status = signal<string>('');
const submitting = signal<boolean>(false);

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseHandleFromBlueskyUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('bsky.app')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'profile' || !parts[1]) return null;
    return parts[1];
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function avatarHueFromDid(did: string): number {
  let h = 0;
  for (let i = 0; i < did.length; i++) h = (h * 31 + did.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Data load ───────────────────────────────────────────────────────────────

async function loadInitialState(): Promise<void> {
  // 1. Auth check first — if not authenticated, show first-run/connect
  const auth = await send('GET_AUTH_STATUS');
  if (!auth.success || !auth.isAuthenticated) {
    screen.value = { kind: 'no-auth' };
    return;
  }

  // 2. Find active tab + extract profile handle if present
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeUrl = tabs[0]?.url;
  const handle = parseHandleFromBlueskyUrl(activeUrl);

  if (!handle) {
    screen.value = { kind: 'no-profile' };
    return;
  }

  // 3. Resolve handle → DID + profile data
  try {
    const resolved = await send('RESOLVE_HANDLE', { handle });
    if (!resolved.success || !resolved.profile) {
      screen.value = { kind: 'no-profile' };
      return;
    }
    const profile: ProfileData = resolved.profile;

    // 4. Check existing block/mute state from local storage
    const existing = await loadExistingAction(profile.did);

    screen.value = { kind: 'action', profile, existing };
  } catch (err) {
    log.error('Failed to resolve handle:', err);
    screen.value = { kind: 'no-profile' };
  }
}

async function loadExistingAction(did: string): Promise<ExistingAction | null> {
  const [tempBlocks, tempMutes, permBlocks, permMutes] = await Promise.all([
    getTempBlocks(),
    getTempMutes(),
    getPermanentBlocks(),
    getPermanentMutes(),
  ]);

  if (tempBlocks[did]) {
    return {
      type: 'block',
      isPermanent: false,
      expiresAt: tempBlocks[did].expiresAt,
      createdAt: tempBlocks[did].createdAt,
    };
  }
  if (permBlocks[did]) {
    return {
      type: 'block',
      isPermanent: true,
      createdAt: permBlocks[did].createdAt,
    };
  }
  if (tempMutes[did]) {
    return {
      type: 'mute',
      isPermanent: false,
      expiresAt: tempMutes[did].expiresAt,
      createdAt: tempMutes[did].createdAt,
    };
  }
  if (permMutes[did]) {
    return {
      type: 'mute',
      isPermanent: true,
      createdAt: permMutes[did].createdAt,
    };
  }
  return null;
}

// ── Actions ─────────────────────────────────────────────────────────────────

function showStatus(msg: string): void {
  status.value = msg;
  setTimeout(() => {
    if (status.value === msg) status.value = '';
  }, 3000);
}

async function performAction(): Promise<void> {
  const cur = screen.value;
  if (cur.kind !== 'action') return;
  const dur = DURATIONS.find((d) => d.id === durationSel.value);
  if (!dur) return;

  submitting.value = true;
  showStatus(actionTab.value === 'block' ? 'Blocking...' : 'Muting...');
  try {
    const res = await send('CREATE_TEMP_ACTION', {
      did: cur.profile.did,
      handle: cur.profile.handle,
      durationMs: dur.ms,
      isMute: actionTab.value === 'mute',
      isPermanent: dur.id === 'perm',
    });
    if (!res.success) throw new Error(res.error || 'Action failed');

    showStatus(`${actionTab.value === 'block' ? 'Blocked' : 'Muted'} @${cur.profile.handle}`);
    // Refresh state to flip into "already blocked"
    const existing = await loadExistingAction(cur.profile.did);
    screen.value = { kind: 'action', profile: cur.profile, existing };
  } catch (err) {
    showStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    submitting.value = false;
  }
}

async function performUnblockOrUnmute(): Promise<void> {
  const cur = screen.value;
  if (cur.kind !== 'action' || !cur.existing) return;

  submitting.value = true;
  const isBlock = cur.existing.type === 'block';
  showStatus(isBlock ? 'Unblocking...' : 'Unmuting...');
  try {
    const res = isBlock
      ? await send('UNBLOCK_USER', { did: cur.profile.did })
      : await send('UNMUTE_USER', { did: cur.profile.did });
    if (!res.success) throw new Error(res.error || 'Action failed');

    // Also clear local storage entry via typed helpers. Temp lives in sync storage,
    // permanent lives in local storage — the previous hand-rolled writes deleted from a
    // local read but wrote to sync, never touching real permanent storage (dead write).
    if (isBlock) {
      await removeTempBlock(cur.profile.did);
      await removePermanentBlock(cur.profile.did);
    } else {
      await removeTempMute(cur.profile.did);
      await removePermanentMute(cur.profile.did);
    }

    showStatus(isBlock ? `Unblocked @${cur.profile.handle}` : `Unmuted @${cur.profile.handle}`);
    screen.value = { kind: 'action', profile: cur.profile, existing: null };
  } catch (err) {
    showStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    submitting.value = false;
  }
}

function openManager(): void {
  browser.tabs.create({ url: browser.runtime.getURL('manager.html') });
}

function openBluesky(): void {
  browser.tabs.create({ url: 'https://bsky.app/' });
}

// ── Components ──────────────────────────────────────────────────────────────

function PopupShell({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="popup-shell">
      <Header />
      {children}
      <StatusLine />
    </div>
  );
}

function Header() {
  return (
    <div class="popup-header">
      <Wordmark size={15} />
      <button class="icon-btn" onClick={openManager} title="Open full manager">
        {Icon.external(15)}
      </button>
    </div>
  );
}

function StatusLine() {
  const msg = status.value;
  return <div class="popup-status">{msg}</div>;
}

function Avatar({
  size,
  hue,
  initials,
  src,
}: {
  size: number;
  hue: number;
  initials: string;
  src?: string;
}) {
  const style: Record<string, string> = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${Math.round(size * 0.42)}px`,
  };
  if (src) {
    style.backgroundImage = `url(${src})`;
  } else {
    style.background = `oklch(78% 0.08 ${hue})`;
  }
  return (
    <div class="eb-avatar" style={style}>
      {src ? '' : initials}
    </div>
  );
}

function ProfileCard({ profile }: { profile: ProfileData }) {
  const name = profile.displayName || profile.handle;
  return (
    <div class="profile-card">
      <Avatar
        size={64}
        hue={avatarHueFromDid(profile.did)}
        initials={initialsFromName(name)}
        src={profile.avatar}
      />
      <div>
        <div class="profile-card__name">{name}</div>
        <div class="eb-mono profile-card__handle">@{profile.handle}</div>
      </div>
    </div>
  );
}

function ActionTabs() {
  const cur = actionTab.value;
  return (
    <div class="action-tabs">
      <button
        class={`action-tab ${cur === 'block' ? 'action-tab--active' : ''}`}
        onClick={() => (actionTab.value = 'block')}
      >
        {Icon.block(16)}
        <span>Block</span>
      </button>
      <button
        class={`action-tab ${cur === 'mute' ? 'action-tab--active' : ''}`}
        onClick={() => (actionTab.value = 'mute')}
      >
        {Icon.mute(16)}
        <span>Mute</span>
      </button>
    </div>
  );
}

function DurationGrid() {
  const sel = durationSel.value;
  return (
    <div class="duration-grid">
      {DURATIONS.map((d) => {
        const isSel = d.id === sel;
        const isPerm = d.id === 'perm';
        const cls = [
          'duration-cell',
          isPerm ? 'duration-cell--perm' : '',
          isSel ? 'duration-cell--selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button key={d.id} class={cls} onClick={() => (durationSel.value = d.id)}>
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

function ActionScreen({ profile }: { profile: ProfileData }) {
  const dur = DURATIONS.find((d) => d.id === durationSel.value);
  const verb = actionTab.value === 'block' ? 'Block' : 'Mute';
  const ctaLabel =
    durationSel.value === 'perm'
      ? `${verb} permanently`
      : `${verb} for ${dur?.label.toLowerCase()}`;
  return (
    <PopupShell>
      <ProfileCard profile={profile} />
      <ActionTabs />
      <div class="popup-body">
        <div>
          <div class="popup-body__label">Duration</div>
          <DurationGrid />
        </div>
        <div class="popup-footer">
          <Btn
            variant="primary"
            size="lg"
            block
            onClick={performAction}
            disabled={submitting.value}
          >
            {ctaLabel}
          </Btn>
          <div class="popup-meta">
            <span>Choose how long, then confirm</span>
            <button class="popup-meta__link" onClick={openManager}>
              Manage all
            </button>
          </div>
        </div>
      </div>
    </PopupShell>
  );
}

function AlreadyActionedScreen({
  profile,
  existing,
}: {
  profile: ProfileData;
  existing: ExistingAction;
}) {
  const isBlock = existing.type === 'block';
  const verb = isBlock ? 'Blocked' : 'Muted';
  const remaining = existing.expiresAt ? existing.expiresAt - Date.now() : 0;
  const sub = existing.isPermanent
    ? `Permanent ${existing.type}.`
    : `Expires in ${formatDuration(remaining)}.`;
  return (
    <PopupShell>
      <ProfileCard profile={profile} />
      <div class="popup-body">
        <div class="status-card">
          <div class="status-card__icon">{Icon.clock(16)}</div>
          <div>
            <div class="status-card__title">
              {verb} @{profile.handle}
            </div>
            <div class="status-card__sub">{sub}</div>
          </div>
        </div>
        <div class="popup-footer">
          <Btn
            variant="secondary"
            size="lg"
            block
            onClick={performUnblockOrUnmute}
            disabled={submitting.value}
          >
            {isBlock ? 'Unblock now' : 'Unmute now'}
          </Btn>
          <button class="popup-meta__link" onClick={openManager} style={{ alignSelf: 'center' }}>
            Manage all
          </button>
        </div>
      </div>
    </PopupShell>
  );
}

function NoProfileScreen() {
  return (
    <PopupShell>
      <div class="empty-state">
        <Mark size={48} stroke={1.6} />
        <div class="empty-state__title">Open a Bluesky profile</div>
        <div class="empty-state__sub">
          ergoblock acts on the profile in your active tab. Open a profile on bsky.app, then click
          the extension again.
        </div>
        <Btn variant="secondary" size="md" onClick={openManager}>
          Open manager
        </Btn>
      </div>
    </PopupShell>
  );
}

function NoAuthScreen() {
  return (
    <PopupShell>
      <div class="connect-hero">
        <Mark size={56} stroke={1.6} />
        <div>
          <div class="connect-hero__title">Connect to Bluesky</div>
          <div class="connect-hero__sub">
            ergoblock connects through your existing Bluesky session. Open bsky.app in any tab and
            sign in — we'll sync automatically.
          </div>
        </div>
      </div>
      <div class="connect-actions">
        <Btn variant="primary" size="lg" block onClick={openBluesky}>
          Open Bluesky
        </Btn>
        <button class="connect-helper" onClick={openManager}>
          Open manager instead →
        </button>
      </div>
    </PopupShell>
  );
}

function LoadingScreen() {
  return (
    <PopupShell>
      <div class="loading-state">Loading…</div>
    </PopupShell>
  );
}

function PopupApp() {
  useEffect(() => {
    void loadInitialState();
  }, []);

  const s = screen.value;
  if (s.kind === 'loading') return <LoadingScreen />;
  if (s.kind === 'no-auth') return <NoAuthScreen />;
  if (s.kind === 'no-profile') return <NoProfileScreen />;
  if (s.existing) {
    return <AlreadyActionedScreen profile={s.profile} existing={s.existing} />;
  }
  return <ActionScreen profile={s.profile} />;
}

const root = document.getElementById('app');
if (root) {
  render(<PopupApp />, root);
} else {
  const container = document.createElement('div');
  container.id = 'app';
  document.body.appendChild(container);
  render(<PopupApp />, container);
}
