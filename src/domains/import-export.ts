/**
 * Import/Export operations - handles IMPORT_DATA message from manager UI
 */

import type { ExportData, ImportOptions, ImportResult } from '../types.js';
import { createLogger, sleep } from '../platform/utils.js';
import { getAuthToken, bgApiRequest } from './api-client.js';
import { blockUser } from './graph-ops.js';
import {
  getTempBlocks,
  getTempMutes,
  addTempBlock,
  addTempMute,
} from '../platform/storage/temp-actions.js';
import {
  getPermanentBlocks,
  setPermanentBlocks,
  getPermanentMutes,
  setPermanentMutes,
} from '../platform/storage/permanent.js';
import { addPostContext } from '../platform/storage/history.js';

const log = createLogger('bg:import');

const API_DELAY_MS = 200; // Rate limit between API calls

export async function handleImportData(
  data: ExportData,
  options: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    blocksImported: 0,
    mutesImported: 0,
    contextsImported: 0,
    skippedDuplicates: 0,
    errors: [],
  };

  const auth = await getAuthToken();
  if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
    return { ...result, success: false, errors: ['Not authenticated'] };
  }

  // Load existing state for duplicate detection
  const [existingTempBlocks, existingPermBlocks, existingTempMutes, existingPermMutes] =
    await Promise.all([getTempBlocks(), getPermanentBlocks(), getTempMutes(), getPermanentMutes()]);

  // ── Import blocks ──────────────────────────────────────────────────────
  if (options.importBlocks) {
    for (const block of data.blocks) {
      const alreadyBlocked = block.did in existingTempBlocks || block.did in existingPermBlocks;

      if (alreadyBlocked && options.skipExisting) {
        result.skippedDuplicates++;
        continue;
      }

      try {
        // Create block on Bluesky
        const record = await blockUser(block.did, auth.accessJwt, auth.did, auth.pdsUrl);
        const rkey = record?.uri?.split('/').pop();

        if (options.asTemporary) {
          await addTempBlock(block.did, block.handle, options.tempDuration, rkey);
        } else {
          // Add as permanent block
          const permBlocks = await getPermanentBlocks();
          permBlocks[block.did] = {
            did: block.did,
            handle: block.handle,
            syncedAt: Date.now(),
            createdAt: block.createdAt ?? Date.now(),
            rkey,
          };
          await setPermanentBlocks(permBlocks);
        }

        result.blocksImported++;
        await sleep(API_DELAY_MS);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Block @${block.handle}: ${msg}`);
        log.error(`Failed to import block for ${block.handle}:`, error);
      }
    }
  }

  // ── Import mutes ───────────────────────────────────────────────────────
  if (options.importMutes) {
    for (const mute of data.mutes) {
      const alreadyMuted = mute.did in existingTempMutes || mute.did in existingPermMutes;

      if (alreadyMuted && options.skipExisting) {
        result.skippedDuplicates++;
        continue;
      }

      try {
        // Create mute on Bluesky
        await bgApiRequest(
          'app.bsky.graph.muteActor',
          'POST',
          { actor: mute.did },
          auth.accessJwt,
          auth.pdsUrl
        );

        if (options.asTemporary) {
          await addTempMute(mute.did, mute.handle, options.tempDuration);
        } else {
          // Add as permanent mute
          const permMutes = await getPermanentMutes();
          permMutes[mute.did] = {
            did: mute.did,
            handle: mute.handle,
            syncedAt: Date.now(),
            createdAt: mute.createdAt ?? Date.now(),
          };
          await setPermanentMutes(permMutes);
        }

        result.mutesImported++;
        await sleep(API_DELAY_MS);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Mute @${mute.handle}: ${msg}`);
        log.error(`Failed to import mute for ${mute.handle}:`, error);
      }
    }
  }

  // ── Import post contexts ───────────────────────────────────────────────
  if (options.importContexts && data.contexts) {
    for (const context of data.contexts) {
      try {
        await addPostContext(context);
        result.contextsImported++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Context: ${msg}`);
      }
    }
  }

  if (result.errors.length > 0) {
    log.warn(`Import completed with ${result.errors.length} errors`);
  }
  log.info(
    `Import done: ${result.blocksImported} blocks, ${result.mutesImported} mutes, ${result.contextsImported} contexts, ${result.skippedDuplicates} skipped`
  );

  return result;
}
