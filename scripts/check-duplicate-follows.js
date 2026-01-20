/**
 * Standalone script to check for duplicate follow records in your Bluesky PDS
 *
 * Usage:
 *   node scripts/check-duplicate-follows.js
 *
 * You'll need to set these environment variables or edit them below:
 *   BSKY_HANDLE - your Bluesky handle (e.g., you.bsky.social)
 *   BSKY_PASSWORD - your app password (create one at https://bsky.app/settings/app-passwords)
 */

const HANDLE = process.env.BSKY_HANDLE || '';
const PASSWORD = process.env.BSKY_PASSWORD || '';

if (!HANDLE || !PASSWORD) {
  console.error('Please set BSKY_HANDLE and BSKY_PASSWORD environment variables');
  console.error('Example: BSKY_HANDLE=you.bsky.social BSKY_PASSWORD=xxxx-xxxx-xxxx-xxxx node scripts/check-duplicate-follows.js');
  process.exit(1);
}

async function main() {
  console.log(`Authenticating as ${HANDLE}...`);

  // Login to get session
  const loginRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
  });

  if (!loginRes.ok) {
    const err = await loginRes.text();
    console.error('Login failed:', err);
    process.exit(1);
  }

  const session = await loginRes.json();
  const { did, accessJwt } = session;

  // Get PDS URL from DID document
  const didDocRes = await fetch(`https://plc.directory/${did}`);
  const didDoc = await didDocRes.json();
  const pdsUrl = didDoc.service?.find(s => s.id === '#atproto_pds')?.serviceEndpoint || 'https://bsky.social';

  console.log(`Authenticated as ${did}`);
  console.log(`PDS: ${pdsUrl}`);
  console.log('');
  console.log('Fetching all follow records from PDS...');

  // Fetch all follow records
  const allRecords = [];
  let cursor = undefined;

  do {
    let url = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.graph.follow&limit=100`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessJwt}` },
    });

    if (!res.ok) {
      console.error('Failed to fetch records:', await res.text());
      process.exit(1);
    }

    const data = await res.json();
    if (data.records) {
      allRecords.push(...data.records);
      process.stdout.write(`\rFetched ${allRecords.length} records...`);
    }
    cursor = data.cursor;

    if (cursor) {
      await new Promise(r => setTimeout(r, 100));
    }
  } while (cursor);

  console.log(`\nTotal follow records: ${allRecords.length}`);
  console.log('');

  // Group by subject DID
  const recordsBySubject = new Map();
  for (const record of allRecords) {
    const subject = record.value.subject;
    const existing = recordsBySubject.get(subject) || [];
    existing.push(record);
    recordsBySubject.set(subject, existing);
  }

  console.log(`Unique follows: ${recordsBySubject.size}`);

  // Find duplicates
  const duplicates = [];
  for (const [did, records] of recordsBySubject.entries()) {
    if (records.length > 1) {
      records.sort((a, b) => new Date(a.value.createdAt) - new Date(b.value.createdAt));
      duplicates.push({ did, records });
    }
  }

  const totalDuplicateRecords = duplicates.reduce((sum, d) => sum + d.records.length - 1, 0);

  console.log(`DIDs with duplicates: ${duplicates.length}`);
  console.log(`Extra duplicate records: ${totalDuplicateRecords}`);
  console.log('');

  if (duplicates.length === 0) {
    console.log('No duplicates found! Your PDS is clean.');
    return;
  }

  console.log('=== DUPLICATES FOUND ===');
  console.log('');

  for (const { did, records } of duplicates.slice(0, 20)) {
    console.log(`${did} (${records.length} records):`);
    for (const r of records) {
      console.log(`  - ${r.uri} @ ${r.value.createdAt}`);
    }
  }

  if (duplicates.length > 20) {
    console.log(`... and ${duplicates.length - 20} more`);
  }

  console.log('');
  console.log('To delete duplicates, run with DELETE=1:');
  console.log('  DELETE=1 BSKY_HANDLE=... BSKY_PASSWORD=... node scripts/check-duplicate-follows.js');

  // Delete if requested
  if (process.env.DELETE === '1') {
    console.log('');
    console.log('=== DELETING DUPLICATES ===');
    console.log('');

    let deleted = 0;
    let failed = 0;

    for (const { did: subjectDid, records } of duplicates) {
      // Keep the first (oldest), delete the rest
      for (let i = 1; i < records.length; i++) {
        const record = records[i];
        const rkey = record.uri.split('/').pop();

        try {
          const delRes = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessJwt}`,
            },
            body: JSON.stringify({
              repo: did,
              collection: 'app.bsky.graph.follow',
              rkey,
            }),
          });

          if (delRes.ok) {
            deleted++;
            process.stdout.write(`\rDeleted ${deleted}/${totalDuplicateRecords}...`);
          } else {
            failed++;
            console.error(`\nFailed to delete ${record.uri}:`, await delRes.text());
          }

          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          failed++;
          console.error(`\nError deleting ${record.uri}:`, err.message);
        }
      }
    }

    console.log('');
    console.log(`Deleted: ${deleted}`);
    console.log(`Failed: ${failed}`);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
