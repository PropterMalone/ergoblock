/**
 * List Audit - Audit owned moderation lists
 * Fetches lists, members, and allows removal
 */

import { getAuthToken } from './api-client.js';
import { fetchProfiles } from './graph-ops.js';
import { fetchListsFromCar, fetchListsFromCarWithTimestamps } from './carRepo.js';
import { executeApiRequest } from '../platform/api.js';
import { OwnedList, ListView, ListMember } from '../types.js';
import { createLogger } from '../platform/utils.js';

const log = createLogger('bg:list-audit');

/**
 * Fetch lists owned by the logged-in user from local CAR
 */
export async function handleFetchOwnedLists(): Promise<{
  success: boolean;
  lists?: OwnedList[];
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    log.info('Fetching owned lists from CAR...');

    // Fetch and parse lists from CAR file (no API call needed)
    const result = await fetchListsFromCar(auth.did, auth.pdsUrl);

    // Convert ParsedListData to OwnedList
    const ownedLists: OwnedList[] = Object.values(result.lists).map((list) => ({
      uri: list.uri,
      name: list.name,
      purpose: list.purpose === 'app.bsky.graph.defs#modlist' ? 'modlist' : 'curatelist',
      description: list.description,
      listItemCount: list.members.length,
      createdAt: list.createdAt,
    }));

    log.info(`Fetched ${ownedLists.length} owned lists from CAR`);
    return { success: true, lists: ownedLists };
  } catch (error) {
    log.error('Fetch owned lists failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Fetch list members with timestamps from CAR file
 */
export async function handleFetchListMembersWithTimestamps(listUri: string): Promise<{
  success: boolean;
  members?: ListMember[];
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get list name from API first
    const listResponse = await executeApiRequest<{ list: ListView }>(
      `app.bsky.graph.getList?list=${encodeURIComponent(listUri)}&limit=1`,
      'GET',
      null,
      { accessJwt: auth.accessJwt, pdsUrl: auth.pdsUrl }
    );
    const listName = listResponse?.list?.name || 'Unknown List';

    // Fetch user's CAR file and parse for list items
    const targetListUris = new Set([listUri]);
    const parsedLists = await fetchListsFromCarWithTimestamps(
      auth.did,
      auth.pdsUrl,
      targetListUris
    );

    const parsedList = parsedLists.lists[listUri];
    if (!parsedList || parsedList.members.length === 0) {
      return { success: true, members: [] };
    }

    // Hydrate member profiles
    const memberDids = parsedList.members.map((m) => m.did);
    const profiles = await fetchProfiles(memberDids, auth.accessJwt);
    const profileMap = new Map(profiles.map((p) => [p.did, p]));

    // Build ListMember array
    const members: ListMember[] = parsedList.members.map((m) => {
      const profile = profileMap.get(m.did);
      return {
        did: m.did,
        handle: profile?.handle || m.did,
        displayName: profile?.displayName,
        avatar: profile?.avatar,
        listUri,
        listName,
        addedAt: m.addedAt,
        listitemRkey: m.rkey,
      };
    });

    // Sort by addedAt descending (most recent first)
    members.sort((a, b) => b.addedAt - a.addedAt);

    log.info(`Fetched ${members.length} members with timestamps for ${listName}`);
    return { success: true, members };
  } catch (error) {
    log.error('Fetch list members with timestamps failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Remove a member from a list by deleting the listitem record
 */
export async function handleRemoveFromList(rkey: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.accessJwt || !auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }

    await executeApiRequest(
      'com.atproto.repo.deleteRecord',
      'POST',
      {
        repo: auth.did,
        collection: 'app.bsky.graph.listitem',
        rkey,
      },
      { accessJwt: auth.accessJwt, pdsUrl: auth.pdsUrl }
    );

    log.info(`Removed list item with rkey: ${rkey}`);
    return { success: true };
  } catch (error) {
    log.error('Remove from list failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
