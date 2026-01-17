/**
 * Shared utility functions
 */

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate a DID (Decentralized Identifier) format
 * Valid formats: did:plc:* or did:web:*
 * @param did - The DID to validate
 * @returns true if valid, false otherwise
 */
export function isValidDid(did: string): boolean {
  if (!did || typeof did !== 'string') return false;
  // DID format: did:<method>:<method-specific-id>
  // Bluesky uses did:plc: and did:web: methods
  return /^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(did);
}

/**
 * Validate a duration in milliseconds
 * @param durationMs - Duration in milliseconds
 * @returns true if valid (positive finite number, max 1 year), false otherwise
 */
export function isValidDuration(durationMs: number): boolean {
  if (typeof durationMs !== 'number') return false;
  if (!Number.isFinite(durationMs)) return false;
  if (durationMs <= 0) return false;
  // Max duration: 1 year (prevent overflow/abuse)
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  if (durationMs > ONE_YEAR_MS) return false;
  return true;
}

/**
 * Validate a Bluesky handle format
 * @param handle - The handle to validate
 * @returns true if valid, false otherwise
 */
export function isValidHandle(handle: string): boolean {
  if (!handle || typeof handle !== 'string') return false;
  // Handle format: alphanumeric with dots, hyphens, underscores
  // Must have at least one dot (domain-like)
  // Max length 253 (DNS limit)
  if (handle.length > 253) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)+$/.test(handle);
}

/**
 * Validate an AT Protocol URI format
 * @param uri - The URI to validate (e.g., at://did:plc:abc/app.bsky.feed.post/xyz)
 * @returns true if valid, false otherwise
 */
export function isValidAtUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false;
  // AT URI format: at://<authority>/<collection>/<rkey>
  return /^at:\/\/did:(plc|web):[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.]+\/[a-zA-Z0-9._~-]+$/.test(uri);
}

/**
 * Validate and sanitize a timestamp
 * @param timestamp - Timestamp in milliseconds
 * @returns true if valid (positive finite number, reasonable range), false otherwise
 */
export function isValidTimestamp(timestamp: number): boolean {
  if (typeof timestamp !== 'number') return false;
  if (!Number.isFinite(timestamp)) return false;
  if (timestamp <= 0) return false;
  // Must be after year 2020 and before year 2100 (reasonable range)
  const MIN_TS = new Date('2020-01-01').getTime();
  const MAX_TS = new Date('2100-01-01').getTime();
  return timestamp >= MIN_TS && timestamp <= MAX_TS;
}

/**
 * Generate a unique ID with a prefix
 */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Options for retry with exponential backoff
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: retry on network/5xx errors) */
  isRetryable?: (error: Error) => boolean;
  /** Optional callback for each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Default function to determine if an error is retryable
 * Retries on: network errors, 5xx server errors, 429 rate limits
 * Does NOT retry on: 4xx client errors (except 429), auth errors
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors - always retry
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('enotfound')
  ) {
    return true;
  }

  // Rate limiting - retry with backoff
  if (message.includes('429') || message.includes('rate limit')) {
    return true;
  }

  // Server errors (5xx) - retry
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }

  // Auth errors (401) - do NOT retry, token needs refresh
  if (message.includes('401') || message.includes('auth error')) {
    return false;
  }

  // Other 4xx client errors - do NOT retry
  if (message.includes('400') || message.includes('403') || message.includes('404')) {
    return false;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Execute a function with retry and exponential backoff
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Result of the function
 * @throws Last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this was the last attempt or error is not retryable, throw immediately
      if (attempt === maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate delay with jitter (±10%) to prevent thundering herd
      const jitter = delay * 0.1 * (Math.random() * 2 - 1);
      const actualDelay = Math.min(delay + jitter, maxDelayMs);

      // Notify about retry
      onRetry?.(attempt + 1, lastError, actualDelay);
      console.log(
        `[ErgoBlock] Retry ${attempt + 1}/${maxRetries} after ${Math.round(actualDelay)}ms: ${lastError.message}`
      );

      // Wait before retry
      await sleep(actualDelay);

      // Increase delay for next attempt
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}
