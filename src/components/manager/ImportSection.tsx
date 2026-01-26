import type { JSX } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { Upload, AlertCircle, CheckCircle, Loader2 } from 'lucide-preact';
import browser from '../../browser.js';
import { validateExportData } from '../../storage.js';
import type { ExportData, ImportResult, ImportOptions } from '../../types.js';

interface ImportSectionProps {
  onReload: () => Promise<void>;
}

const DURATION_OPTIONS = [
  { value: 3600000, label: '1 hour' },
  { value: 21600000, label: '6 hours' },
  { value: 43200000, label: '12 hours' },
  { value: 86400000, label: '24 hours' },
  { value: 259200000, label: '3 days' },
  { value: 604800000, label: '1 week' },
];

export function ImportSection({ onReload }: ImportSectionProps): JSX.Element {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<ExportData | null>(null);
  const [options, setOptions] = useState<ImportOptions>({
    importBlocks: true,
    importMutes: true,
    importContexts: true,
    skipExisting: true,
    asTemporary: false,
    tempDuration: 86400000, // 24 hours
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    setPreviewData(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!validateExportData(data)) {
        setError('Invalid export file format. Please select a valid ErgoBlock export file.');
        return;
      }

      setPreviewData(data as ExportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const handleImport = async () => {
    if (!previewData) return;

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const importResult = (await browser.runtime.sendMessage({
        type: 'IMPORT_DATA',
        data: previewData,
        options,
      })) as ImportResult;

      setResult(importResult);
      setPreviewData(null);

      // Reload data to reflect changes
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCancel = () => {
    setPreviewData(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div class="import-section">
      <h3>Import Data</h3>

      {/* File input (hidden) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Preview mode */}
      {previewData && !importing && !result && (
        <div class="import-preview">
          <div class="import-preview-stats">
            <p>
              <strong>File contains:</strong>
            </p>
            <ul>
              <li>{previewData.blocks.length} blocks</li>
              <li>{previewData.mutes.length} mutes</li>
              <li>{previewData.contexts?.length || 0} post contexts</li>
            </ul>
            <p class="import-preview-date">
              Exported: {new Date(previewData.exportedAt).toLocaleString()}
            </p>
          </div>

          <div class="import-options">
            <label class="import-checkbox">
              <input
                type="checkbox"
                checked={options.importBlocks}
                onChange={(e) =>
                  setOptions({ ...options, importBlocks: (e.target as HTMLInputElement).checked })
                }
              />
              Import Blocks ({previewData.blocks.length})
            </label>

            <label class="import-checkbox">
              <input
                type="checkbox"
                checked={options.importMutes}
                onChange={(e) =>
                  setOptions({ ...options, importMutes: (e.target as HTMLInputElement).checked })
                }
              />
              Import Mutes ({previewData.mutes.length})
            </label>

            <label class="import-checkbox">
              <input
                type="checkbox"
                checked={options.importContexts}
                onChange={(e) =>
                  setOptions({ ...options, importContexts: (e.target as HTMLInputElement).checked })
                }
              />
              Import Post Contexts ({previewData.contexts?.length || 0})
            </label>

            <label class="import-checkbox">
              <input
                type="checkbox"
                checked={options.skipExisting}
                onChange={(e) =>
                  setOptions({ ...options, skipExisting: (e.target as HTMLInputElement).checked })
                }
              />
              Skip already blocked/muted users
            </label>

            <label class="import-checkbox">
              <input
                type="checkbox"
                checked={options.asTemporary}
                onChange={(e) =>
                  setOptions({ ...options, asTemporary: (e.target as HTMLInputElement).checked })
                }
              />
              Import as temporary blocks/mutes
            </label>

            {options.asTemporary && (
              <div class="import-duration">
                <label>Duration:</label>
                <select
                  value={options.tempDuration}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      tempDuration: parseInt((e.target as HTMLSelectElement).value),
                    })
                  }
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div class="import-actions">
            <button class="export-btn import-btn-primary" onClick={handleImport}>
              Import Selected
            </button>
            <button class="export-btn" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Importing state */}
      {importing && (
        <div class="import-status import-loading">
          <Loader2 size={16} class="spinner" />
          Importing data...
        </div>
      )}

      {/* Error display */}
      {error && (
        <div class="import-status import-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Result display */}
      {result && (
        <div class={`import-status ${result.success ? 'import-success' : 'import-warning'}`}>
          <CheckCircle size={16} />
          <div>
            <p>
              Imported: {result.blocksImported} blocks, {result.mutesImported} mutes
              {result.contextsImported > 0 && `, ${result.contextsImported} contexts`}
            </p>
            {result.skippedDuplicates > 0 && (
              <p class="import-result-detail">Skipped {result.skippedDuplicates} duplicates</p>
            )}
            {result.errors.length > 0 && (
              <details class="import-errors">
                <summary>{result.errors.length} errors</summary>
                <ul>
                  {result.errors.slice(0, 10).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {result.errors.length > 10 && <li>... and {result.errors.length - 10} more</li>}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Select file button (when not previewing) */}
      {!previewData && !importing && (
        <button class="export-btn" onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} />
          Select JSON Export File
        </button>
      )}

      <p class="import-note">
        Import a previously exported ErgoBlock JSON file to restore your blocks and mutes.
      </p>
    </div>
  );
}
