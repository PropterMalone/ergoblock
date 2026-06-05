/**
 * CAR cache message handlers - extracted from background.ts
 */

import { getAuthToken } from './api-client.js';
import { getCarFileSize } from './carRepo.js';
import { checkCarCacheStatus, type CarCacheStatus } from './carService.js';
import { invalidateCarCache } from '../platform/carCache.js';

export async function handleCheckCarCacheStatus(): Promise<{
  success: boolean;
  status?: CarCacheStatus;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }
    const status = await checkCarCacheStatus(auth.did, auth.pdsUrl);
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleEstimateCarSize(): Promise<{
  success: boolean;
  sizeBytes?: number;
  error?: string;
}> {
  try {
    const auth = await getAuthToken();
    if (!auth?.did || !auth?.pdsUrl) {
      return { success: false, error: 'Not authenticated' };
    }
    const sizeBytes = await getCarFileSize(auth.did, auth.pdsUrl);
    return { success: true, sizeBytes: sizeBytes ?? undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleInvalidateCarCache(): Promise<{ success: boolean; error?: string }> {
  try {
    const auth = await getAuthToken();
    if (!auth?.did) {
      return { success: false, error: 'Not authenticated' };
    }
    await invalidateCarCache(auth.did);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
