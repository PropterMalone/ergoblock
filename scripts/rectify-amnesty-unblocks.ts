/**
 * Rectification script for failed Amnesty unblocks
 *
 * This script identifies amnesty reviews marked as 'unblocked' where
 * the user is still actually blocked on Bluesky (due to a bug where
 * the review was recorded before the unblock succeeded).
 *
 * Usage:
 *   npx ts-node scripts/rectify-amnesty-unblocks.ts
 *
 * Or run in dry-run mode first:
 *   DRY_RUN=1 npx ts-node scripts/rectify-amnesty-unblocks.ts
 */

// This script must be run in a browser context (extension background page)
// or via the extension's developer console. It cannot run standalone.

interface AmnestyReview {
  did: string;
  handle: string;
  reviewedAt: number;
  type: 'block' | 'mute';
  decision: 'unblocked' | 'unmuted' | 'kept_blocked' | 'kept_muted';
}

interface BlockRecord {
  uri: string;
  value: {
    subject: string;
    createdAt: string;
  };
}

interface ListRecordsResponse {
  records?: BlockRecord[];
  cursor?: string;
}

/**
 * Run this function from the extension's background page console
 * or inject it into the extension context.
 */
async function rectifyAmnestyUnblocks(dryRun = true): Promise<void> {
  console.log(`\n=== Amnesty Unblock Rectification Script ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will unblock users)'}\n`);

  // Get amnesty reviews from local storage
  const result = await chrome.storage.local.get('amnestyReviews');
  const reviews: AmnestyReview[] = result.amnestyReviews || [];

  // Filter to only 'unblocked' decisions for blocks
  const unblockedReviews = reviews.filter(
    (r) => r.decision === 'unblocked' && r.type === 'block'
  );

  console.log(`Found ${unblockedReviews.length} amnesty reviews marked as 'unblocked'\n`);

  if (unblockedReviews.length === 0) {
    console.log('No unblocked reviews to check.');
    return;
  }

  // Get auth token
  const authResult = await chrome.storage.local.get('authToken');
  const auth = authResult.authToken;

  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.error('Not authenticated. Please log in to the extension first.');
    return;
  }

  // Fetch all block records from Bluesky (paginated)
  console.log('Fetching all block records from Bluesky...');
  const blockedDids = new Set<string>();
  const blockRkeys = new Map<string, string>(); // DID -> rkey
  let cursor: string | undefined;

  do {
    const url = cursor
      ? `${auth.pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100&cursor=${cursor}`
      : `${auth.pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.accessJwt}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch blocks: ${response.status} ${response.statusText}`);
    }

    const data: ListRecordsResponse = await response.json();

    for (const record of data.records || []) {
      const did = record.value.subject;
      const rkey = record.uri.split('/').pop();
      blockedDids.add(did);
      if (rkey) {
        blockRkeys.set(did, rkey);
      }
    }

    cursor = data.cursor;
  } while (cursor);

  console.log(`Found ${blockedDids.size} total blocks on Bluesky\n`);

  // Find reviews marked as unblocked but user is still blocked
  const failedUnblocks: AmnestyReview[] = [];
  for (const review of unblockedReviews) {
    if (blockedDids.has(review.did)) {
      failedUnblocks.push(review);
    }
  }

  console.log(`Found ${failedUnblocks.length} failed unblocks (marked unblocked but still blocked)\n`);

  if (failedUnblocks.length === 0) {
    console.log('All amnesty unblocks were successful. Nothing to rectify.');
    return;
  }

  // List the failed unblocks
  console.log('Failed unblocks to rectify:');
  for (const review of failedUnblocks) {
    const date = new Date(review.reviewedAt).toISOString();
    console.log(`  - @${review.handle} (${review.did}) - reviewed at ${date}`);
  }
  console.log('');

  if (dryRun) {
    console.log('DRY RUN: No changes made. Run with dryRun=false to actually unblock.');
    return;
  }

  // Actually unblock the users
  console.log('Unblocking users...\n');
  let successCount = 0;
  let failCount = 0;

  for (const review of failedUnblocks) {
    const rkey = blockRkeys.get(review.did);

    if (!rkey) {
      console.log(`  SKIP: @${review.handle} - no rkey found (might have been unblocked already)`);
      continue;
    }

    try {
      const response = await fetch(`${auth.pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo: auth.did,
          collection: 'app.bsky.graph.block',
          rkey,
        }),
      });

      if (response.ok) {
        console.log(`  ✓ Unblocked @${review.handle}`);
        successCount++;
      } else {
        const errorText = await response.text();
        console.log(`  ✗ Failed to unblock @${review.handle}: ${response.status} ${errorText}`);
        failCount++;
      }
    } catch (error) {
      console.log(`  ✗ Error unblocking @${review.handle}:`, error);
      failCount++;
    }

    // Rate limit: wait 100ms between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Successfully unblocked: ${successCount}`);
  console.log(`Failed to unblock: ${failCount}`);
  console.log(`Total processed: ${failedUnblocks.length}`);
}

// Export for use in extension context
// To use: open extension background page console and run:
//   rectifyAmnestyUnblocks(true)  // dry run
//   rectifyAmnestyUnblocks(false) // actually unblock
(globalThis as unknown as Record<string, unknown>).rectifyAmnestyUnblocks = rectifyAmnestyUnblocks;

console.log('Rectification script loaded. Run rectifyAmnestyUnblocks(true) for dry run, or rectifyAmnestyUnblocks(false) to fix.');
