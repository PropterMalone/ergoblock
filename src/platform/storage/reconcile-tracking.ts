import type { PermanentBlockMute } from '../../types.js';
import type { PermanentBlocksMutesMap } from './permanent.js';

/** Apply a remote snapshot only to entries unchanged since the local snapshot was read. */
export function reconcileTracking(
  current: PermanentBlocksMutesMap,
  baseline: PermanentBlocksMutesMap,
  remote: PermanentBlocksMutesMap,
  ownerDid: string,
  startedAt: number
): void {
  for (const did of new Set([...Object.keys(baseline), ...Object.keys(remote)])) {
    if (JSON.stringify(current[did]) !== JSON.stringify(baseline[did])) continue;
    const previous = current[did];
    if (previous?.ownerDid && previous.ownerDid !== ownerDid) continue;
    const next = remote[did];
    if (!next) {
      if (previous?.createdAt && startedAt - previous.createdAt < 5 * 60 * 1000) continue;
      delete current[did];
    } else {
      const identity: Partial<PermanentBlockMute> =
        previous?.rkey === next.rkey
          ? { trackingId: previous?.trackingId, createdAt: previous?.createdAt ?? next.createdAt }
          : {};
      current[did] = {
        ...next,
        ...identity,
        ...(previous ? { ownerDid: previous.ownerDid } : { ownerDid }),
      };
    }
  }
}
