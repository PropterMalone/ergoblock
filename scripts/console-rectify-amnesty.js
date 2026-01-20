// NOTE: As of the latest version, ErgoBlock automatically rectifies failed
// amnesty unblocks on startup. You can also trigger it manually by running:
//   chrome.runtime.sendMessage({ type: 'RECTIFY_AMNESTY_UNBLOCKS' }, console.log)
// from the bsky.app console.
//
// This script is for manual investigation/fixing if needed.
// Run from the ErgoBlock SERVICE WORKER console:
// 1. Go to chrome://extensions
// 2. Find ErgoBlock, click "Service Worker" link
// 3. Paste this script in that console
//
// First run in dry-run mode, then set DRY_RUN = false to actually fix

const DRY_RUN = true; // Set to false to actually unblock

(async () => {
  // Detect which API is available
  const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage;

  console.log('');
  console.log('=== Amnesty Unblock Rectification Script ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will unblock)'}`);
  console.log('');

  // Get amnesty reviews from storage
  const reviewsResult = await storage.local.get('amnestyReviews');
  const reviews = reviewsResult.amnestyReviews || [];

  // Filter to 'unblocked' decisions for blocks
  const unblockedReviews = reviews.filter(
    (r) => r.decision === 'unblocked' && r.type === 'block'
  );

  console.log(`Found ${unblockedReviews.length} amnesty reviews marked as 'unblocked'`);

  if (unblockedReviews.length === 0) {
    console.log('No unblocked reviews to check.');
    return;
  }

  // Get auth token
  const authResult = await storage.local.get('authToken');
  const auth = authResult.authToken;

  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    console.error('Not authenticated. Please log in to ErgoBlock first.');
    return;
  }

  // Fetch all block records from Bluesky (paginated)
  console.log('Fetching blocks from Bluesky...');
  const blockedDids = new Set();
  const blockRkeys = new Map(); // DID -> rkey
  let cursor = undefined;

  do {
    const url = cursor
      ? `${auth.pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100&cursor=${cursor}`
      : `${auth.pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${auth.did}&collection=app.bsky.graph.block&limit=100`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.accessJwt}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch blocks: ${response.status}`);
    }

    const data = await response.json();

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

  console.log(`Found ${blockedDids.size} total blocks on Bluesky`);
  console.log('');

  // Find failed unblocks (marked unblocked but still blocked)
  const failedUnblocks = [];
  for (const review of unblockedReviews) {
    if (blockedDids.has(review.did)) {
      failedUnblocks.push(review);
    }
  }

  console.log(`Found ${failedUnblocks.length} FAILED unblocks (marked unblocked but still blocked)`);
  console.log('');

  if (failedUnblocks.length === 0) {
    console.log('✓ All amnesty unblocks were successful. Nothing to rectify.');
    return;
  }

  // List them
  console.log('Failed unblocks:');
  for (const review of failedUnblocks) {
    const date = new Date(review.reviewedAt).toLocaleString();
    console.log(`  @${review.handle} - reviewed ${date}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN complete. To actually unblock these users:');
    console.log('1. Copy this script');
    console.log('2. Change "const DRY_RUN = true" to "const DRY_RUN = false"');
    console.log('3. Paste and run again');
    return;
  }

  // Actually unblock
  console.log('Unblocking users...');
  let success = 0;
  let failed = 0;

  for (const review of failedUnblocks) {
    const rkey = blockRkeys.get(review.did);
    if (!rkey) {
      console.log(`  SKIP @${review.handle} - no rkey found`);
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
        success++;
      } else {
        console.log(`  ✗ Failed @${review.handle}: ${response.status}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ✗ Error @${review.handle}:`, e.message);
      failed++;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`Unblocked: ${success}`);
  console.log(`Failed: ${failed}`);
})();
