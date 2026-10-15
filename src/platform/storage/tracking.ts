/** Shared mutation boundary for the four block/mute tracking maps. Auth locks must be outermost. */
export interface TrackingIdentity {
  ownerDid?: string;
  trackingId?: string;
  rkey?: string;
  createdAt?: number;
  expiresAt?: number;
}

export interface TrackingLock {
  readonly token: symbol;
}

export interface TrackingMutationOptions {
  lock?: TrackingLock;
  /** Runs after storage reads, immediately before a write, while holding the lock. */
  beforeWrite?: () => Promise<void>;
}

export interface TrackingEntryOptions extends TrackingMutationOptions {
  ownerDid?: string;
  trackingId?: string;
}

let tail: Promise<unknown> = Promise.resolve();
let active: TrackingLock | undefined;

/** Pass the supplied token to nested storage helpers; never acquire this lock recursively. */
export function withTrackingLock<T>(
  work: (lock: TrackingLock) => Promise<T>,
  lock?: TrackingLock
): Promise<T> {
  if (lock) {
    if (lock !== active) return Promise.reject(new Error('Tracking lock is no longer active'));
    return work(lock);
  }
  const result = tail.then(async () => {
    const run = async () => {
      const held = { token: Symbol('tracking') };
      active = held;
      try {
        return await work(held);
      } finally {
        active = undefined;
      }
    };
    // Extension pages and the background worker have separate module instances.
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request('ergoblock-tracking', run) : run();
  });
  tail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Missing identity fields are compared too: a legacy entry cannot match an owned receipt. */
export function trackingMatches(
  current: TrackingIdentity | undefined,
  expected: TrackingIdentity
): boolean {
  return (
    !!current &&
    current.ownerDid === expected.ownerDid &&
    current.trackingId === expected.trackingId &&
    current.rkey === expected.rkey &&
    current.createdAt === expected.createdAt &&
    current.expiresAt === expected.expiresAt
  );
}
