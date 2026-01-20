// Paste this entire script into the browser console while on bsky.app with ErgoBlock loaded
// It will scan for duplicate follow records and report what it finds

(async () => {
  console.log('Scanning for duplicate follow records...');

  const result = await chrome.runtime.sendMessage({ type: 'SCAN_DUPLICATE_FOLLOWS' });

  console.log('');
  console.log('=== SCAN RESULTS ===');
  console.log(`Total follow records: ${result.totalRecords}`);
  console.log(`Unique follows: ${result.uniqueFollows}`);
  console.log(`DIDs with duplicates: ${result.duplicateDids}`);
  console.log(`Extra duplicate records: ${result.duplicateRecords}`);

  if (result.duplicateDids === 0) {
    console.log('');
    console.log('✓ No duplicates found! Your PDS is clean.');
    return;
  }

  console.log('');
  console.log('=== DUPLICATE DETAILS ===');
  for (const d of result.duplicateDetails.slice(0, 20)) {
    console.log(`${d.did} has ${d.count} records`);
  }
  if (result.duplicateDetails.length > 20) {
    console.log(`... and ${result.duplicateDetails.length - 20} more`);
  }

  console.log('');
  console.log('To DELETE duplicates, run this in console:');
  console.log("chrome.runtime.sendMessage({ type: 'SCAN_DUPLICATE_FOLLOWS', deleteDuplicates: true }, console.log)");
})();
