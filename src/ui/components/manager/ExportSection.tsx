import type { JSX } from 'preact';
import { blocks, mutes, history, contexts } from '../../signals/manager.js';
import { escapeCSV, downloadCSV, downloadJSON } from './utils.js';

export function ExportSection(): JSX.Element {
  const exportBlocksCSV = () => {
    const headers = ['DID', 'Handle', 'Display Name', 'Source', 'Expires At', 'Created At'];
    const rows = blocks.value.map((b) => [
      b.did,
      b.handle,
      b.displayName || '',
      b.source,
      b.expiresAt ? new Date(b.expiresAt).toISOString() : '',
      b.createdAt
        ? new Date(b.createdAt).toISOString()
        : b.syncedAt
          ? new Date(b.syncedAt).toISOString()
          : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
    downloadCSV(csv, `ergoblock-blocks-${Date.now()}.csv`);
  };

  const exportMutesCSV = () => {
    const headers = ['DID', 'Handle', 'Display Name', 'Source', 'Expires At', 'Created At'];
    const rows = mutes.value.map((m) => [
      m.did,
      m.handle,
      m.displayName || '',
      m.source,
      m.expiresAt ? new Date(m.expiresAt).toISOString() : '',
      m.createdAt
        ? new Date(m.createdAt).toISOString()
        : m.syncedAt
          ? new Date(m.syncedAt).toISOString()
          : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
    downloadCSV(csv, `ergoblock-mutes-${Date.now()}.csv`);
  };

  const exportHistoryCSV = () => {
    const headers = [
      'DID',
      'Handle',
      'Action',
      'Timestamp',
      'Trigger',
      'Success',
      'Error',
      'Duration',
    ];
    const rows = history.value.map((h) => [
      h.did,
      h.handle,
      h.action,
      new Date(h.timestamp).toISOString(),
      h.trigger,
      h.success ? 'Yes' : 'No',
      h.error || '',
      h.duration ? Math.round(h.duration / 1000 / 60).toString() + ' min' : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
    downloadCSV(csv, `ergoblock-history-${Date.now()}.csv`);
  };

  const exportContextsCSV = () => {
    const headers = [
      'Post URI',
      'Post Author',
      'Target Handle',
      'Target DID',
      'Action',
      'Permanent',
      'Auto-detected',
      'Timestamp',
      'Post Text',
    ];
    const rows = contexts.value.map((c) => [
      c.postUri,
      c.postAuthorHandle || c.postAuthorDid,
      c.targetHandle,
      c.targetDid,
      c.actionType,
      c.permanent ? 'Yes' : 'No',
      c.guessed ? 'Yes' : 'No',
      new Date(c.timestamp).toISOString(),
      c.postText || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(',')).join('\n');
    downloadCSV(csv, `ergoblock-contexts-${Date.now()}.csv`);
  };

  const exportAllJSON = () => {
    const data = {
      blocks: blocks.value,
      mutes: mutes.value,
      history: history.value,
      contexts: contexts.value,
      exportedAt: new Date().toISOString(),
    };
    downloadJSON(data, `ergoblock-export-${Date.now()}.json`);
  };

  return (
    <div class="export-section">
      <h3>Export Data</h3>
      <div class="export-buttons">
        <button class="export-btn" onClick={exportBlocksCSV}>
          Export Blocks (CSV)
        </button>
        <button class="export-btn" onClick={exportMutesCSV}>
          Export Mutes (CSV)
        </button>
        <button class="export-btn" onClick={exportHistoryCSV}>
          Export History (CSV)
        </button>
        <button class="export-btn" onClick={exportContextsCSV}>
          Export Post Contexts (CSV)
        </button>
        <button class="export-btn" onClick={exportAllJSON}>
          Export Everything (JSON)
        </button>
      </div>
    </div>
  );
}
