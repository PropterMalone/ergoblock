/**
 * PDS Tools - Debug and diagnostic tools for PDS issues
 */

import { getAuthToken, bgApiRequest } from './api-client.js';
import { invalidateFollowsCache } from './social-graph.js';
import { getRecordCountsFromCar } from './carRepo.js';
import { createLogger, sleep } from '../platform/utils.js';

const log = createLogger('bg:pds-tools');

/**
 * Scan for duplicate follows and optionally delete them
 */
export async function handleScanDuplicateFollows(deleteDuplicates: boolean) {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Scanning for duplicate follows...');

    // Fetch all follow records
    let cursor: string | undefined;
    const allRecords: Array<{ uri: string; value: { subject: string; createdAt: string } }> = [];

    do {
      const url = cursor
        ? `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.follow&limit=100&cursor=${cursor}`
        : `com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.follow&limit=100`;

      const response = await bgApiRequest<{
        records: Array<{ uri: string; value: { subject: string; createdAt: string } }>;
        cursor?: string;
      }>(url, 'GET', null, auth.accessJwt, auth.pdsUrl);

      if (response?.records) {
        allRecords.push(...response.records);
      }
      cursor = response?.cursor;
    } while (cursor);

    // Find duplicates (same subject DID)
    const seenDids = new Map<string, typeof allRecords>();
    const duplicates: typeof allRecords = [];

    for (const record of allRecords) {
      const did = record.value.subject;
      const existing = seenDids.get(did);
      if (existing) {
        // Keep the older record, mark newer as duplicate
        const existingTime = new Date(existing[0].value.createdAt).getTime();
        const currentTime = new Date(record.value.createdAt).getTime();
        if (currentTime > existingTime) {
          duplicates.push(record);
        } else {
          duplicates.push(...existing);
          seenDids.set(did, [record]);
        }
      } else {
        seenDids.set(did, [record]);
      }
    }

    log.info(`Found ${duplicates.length} duplicate follows out of ${allRecords.length} total`);

    if (!deleteDuplicates || duplicates.length === 0) {
      return { success: true, total: allRecords.length, duplicates: duplicates.length, deleted: 0 };
    }

    // Delete duplicates
    let deleted = 0;
    for (const record of duplicates) {
      try {
        const rkey = record.uri.split('/').pop();
        if (rkey) {
          await bgApiRequest(
            'com.atproto.repo.deleteRecord',
            'POST',
            {
              repo: auth.did,
              collection: 'app.bsky.graph.follow',
              rkey,
            },
            auth.accessJwt,
            auth.pdsUrl
          );
          deleted++;
          await sleep(100);
        }
      } catch (error) {
        log.error('Failed to delete duplicate follow:', error);
      }
    }

    // Invalidate cache
    await invalidateFollowsCache();

    log.info(`Deleted ${deleted} duplicate follows`);
    return { success: true, total: allRecords.length, duplicates: duplicates.length, deleted };
  } catch (error) {
    log.error('Scan duplicate follows failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get record counts from CAR file (for debugging)
 */
export async function handleGetPdsRecordCounts() {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Getting PDS record counts...');
    const counts = await getRecordCountsFromCar(auth.did, auth.pdsUrl);

    log.info('PDS record counts:', counts);
    return { success: true, counts };
  } catch (error) {
    log.error('Get PDS record counts failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Debug tool: Find orphan blocks (blocks without corresponding permanent storage entry)
 */
export async function handleDebugFindOrphanBlocks() {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Scanning for orphan blocks...');

    // This is a diagnostic tool - implementation would compare
    // PDS block records against local storage
    // For now, return placeholder
    return { success: true, orphans: [] };
  } catch (error) {
    log.error('Debug find orphan blocks failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
