/**
 * Shared utility functions
 */

// ============================================================================
// Logging Utilities
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to 'info' in production, 'debug' in development
let currentLogLevel: LogLevel = 'info';

/**
 * Set the minimum log level for output
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Structured logger with levels
 */
export const logger = {
  debug: (message: string, ...args: unknown[]): void => {
    if (LOG_LEVEL_PRIORITY[currentLogLevel] <= LOG_LEVEL_PRIORITY.debug) {
      console.debug(`[ErgoBlock] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    if (LOG_LEVEL_PRIORITY[currentLogLevel] <= LOG_LEVEL_PRIORITY.info) {
      console.log(`[ErgoBlock] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]): void => {
    if (LOG_LEVEL_PRIORITY[currentLogLevel] <= LOG_LEVEL_PRIORITY.warn) {
      console.warn(`[ErgoBlock] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: unknown[]): void => {
    if (LOG_LEVEL_PRIORITY[currentLogLevel] <= LOG_LEVEL_PRIORITY.error) {
      console.error(`[ErgoBlock] ${message}`, ...args);
    }
  },
};

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Simple rate limiter for user-initiated actions
 * Prevents rapid repeated actions that could overwhelm the API
 */
export class RateLimiter {
  private lastActionTime = 0;
  private actionCount = 0;
  private readonly windowMs: number;
  private readonly maxActions: number;
  private readonly cooldownMs: number;

  constructor(options: { windowMs?: number; maxActions?: number; cooldownMs?: number } = {}) {
    this.windowMs = options.windowMs ?? 10000; // 10 second window
    this.maxActions = options.maxActions ?? 5; // Max 5 actions per window
    this.cooldownMs = options.cooldownMs ?? 2000; // 2 second cooldown between actions
  }

  /**
   * Check if an action is allowed
   * @returns true if allowed, false if rate limited
   */
  canPerformAction(): boolean {
    const now = Date.now();

    // Reset window if expired
    if (now - this.lastActionTime > this.windowMs) {
      this.actionCount = 0;
    }

    // Check cooldown
    if (now - this.lastActionTime < this.cooldownMs) {
      return false;
    }

    // Check action count
    if (this.actionCount >= this.maxActions) {
      return false;
    }

    return true;
  }

  /**
   * Record an action
   */
  recordAction(): void {
    const now = Date.now();

    // Reset window if expired
    if (now - this.lastActionTime > this.windowMs) {
      this.actionCount = 0;
    }

    this.lastActionTime = now;
    this.actionCount++;
  }

  /**
   * Get time until next action is allowed (in ms)
   */
  getWaitTime(): number {
    const now = Date.now();
    const cooldownRemaining = Math.max(0, this.cooldownMs - (now - this.lastActionTime));

    if (this.actionCount >= this.maxActions) {
      const windowRemaining = Math.max(0, this.windowMs - (now - this.lastActionTime));
      return Math.max(cooldownRemaining, windowRemaining);
    }

    return cooldownRemaining;
  }
}

// Global rate limiter for block/mute actions
export const actionRateLimiter = new RateLimiter({
  windowMs: 10000, // 10 seconds
  maxActions: 5, // Max 5 blocks/mutes per 10 seconds
  cooldownMs: 1000, // 1 second minimum between actions
});

// ============================================================================
// Circuit Breaker
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker to prevent cascading failures
 * Opens circuit after threshold failures, allowing system to recover
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private successesSinceHalfOpen = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(
    options: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
      halfOpenSuccessThreshold?: number;
    } = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000; // 1 minute
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Check if circuit allows requests
   */
  isAllowed(): boolean {
    this.updateState();
    return this.state !== 'open';
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.updateState();

    if (this.state === 'half-open') {
      this.successesSinceHalfOpen++;
      if (this.successesSinceHalfOpen >= this.halfOpenSuccessThreshold) {
        this.reset();
      }
    } else if (this.state === 'closed') {
      // Decay failures on success
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.updateState();

    if (this.state === 'half-open') {
      // Any failure in half-open reopens the circuit
      this.trip();
    } else if (this.state === 'closed') {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.failureThreshold) {
        this.trip();
      }
    }
  }

  /**
   * Manually reset the circuit
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successesSinceHalfOpen = 0;
    logger.info('Circuit breaker reset to closed');
  }

  private trip(): void {
    this.state = 'open';
    this.lastFailureTime = Date.now();
    logger.warn(`Circuit breaker opened after ${this.failures} failures`);
  }

  private updateState(): void {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
        this.successesSinceHalfOpen = 0;
        logger.info('Circuit breaker entering half-open state');
      }
    }
  }
}

// Global circuit breaker for Bluesky API
export const apiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute
  halfOpenSuccessThreshold: 2,
});

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  return /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)+$/.test(
    handle
  );
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
 * Normalize an AT URI to a canonical form
 * - Ensures consistent format for comparison
 * - Handles both DID and handle-based URIs
 * @param uri - The URI to normalize
 * @returns normalized URI or original if not a valid AT URI
 */
export function normalizeAtUri(uri: string): string {
  if (!uri || typeof uri !== 'string') return uri;

  // Remove any trailing slashes
  uri = uri.replace(/\/+$/, '');

  // Normalize to lowercase for the DID portion (DIDs are case-insensitive)
  const match = uri.match(/^at:\/\/(did:[a-z]+:[^/]+)(\/.*)?$/i);
  if (match) {
    const did = match[1].toLowerCase();
    const path = match[2] || '';
    return `at://${did}${path}`;
  }

  return uri;
}

// ============================================================================
// PDS URL Validation
// ============================================================================

// Allowed PDS domain patterns for Bluesky
const ALLOWED_PDS_PATTERNS = [
  /^https:\/\/[a-zA-Z0-9-]+\.bsky\.network$/,
  /^https:\/\/bsky\.social$/,
  /^https:\/\/[a-zA-Z0-9-]+\.bsky\.social$/,
  /^https:\/\/[a-zA-Z0-9-]+\.host\.bsky\.network$/,
  // Self-hosted PDS on standard ports
  /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(:\d+)?$/,
];

/**
 * Validate and normalize a PDS URL
 * @param url - The PDS URL to validate
 * @returns normalized URL if valid, null if invalid
 */
export function validatePdsUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  // Normalize the URL
  let normalized = url.trim();

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Ensure https:// prefix
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  // Reject http:// in production (only https allowed)
  if (normalized.startsWith('http://')) {
    // Allow localhost for development
    if (!normalized.includes('localhost') && !normalized.includes('127.0.0.1')) {
      logger.warn('Rejecting non-HTTPS PDS URL:', normalized);
      return null;
    }
  }

  // Parse URL to validate structure
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    logger.warn('Invalid PDS URL format:', normalized);
    return null;
  }

  // Reject URLs with paths (PDS root only)
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    logger.warn('PDS URL should not have a path:', normalized);
    return null;
  }

  // Reject URLs with query strings or fragments
  if (parsed.search || parsed.hash) {
    logger.warn('PDS URL should not have query or hash:', normalized);
    return null;
  }

  // Check against allowed patterns
  const isAllowed = ALLOWED_PDS_PATTERNS.some((pattern) => pattern.test(normalized));

  // For localhost/development, allow any port
  const isLocalhost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname.endsWith('.localhost');

  if (!isAllowed && !isLocalhost) {
    // Log warning but still allow - user may have self-hosted PDS
    logger.warn('PDS URL not in known patterns, allowing with caution:', normalized);
  }

  // Return the normalized URL (without trailing slash)
  return `${parsed.protocol}//${parsed.host}`;
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
 *
 * Note: ExpiredToken errors (400) are NOT retried here - they're handled
 * separately by bgApiRequest which refreshes the token and retries.
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
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  ) {
    return true;
  }

  // Auth errors (401) - do NOT retry here, let caller handle refresh
  if (message.includes('401') || message.includes('auth error')) {
    return false;
  }

  // Expired token errors - do NOT retry here, let bgApiRequest handle refresh
  // These come as 400 errors with "ExpiredToken" or "Token has expired"
  if (
    message.includes('expiredtoken') ||
    message.includes('token has expired') ||
    message.includes('expired token')
  ) {
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
 * @throws Last error if all retries fail, or TypeError if fn is not a function
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  // HIGH FIX #6: Validate fn is callable
  if (typeof fn !== 'function') {
    throw new TypeError('withRetry: first argument must be a function');
  }

  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  // Validate options
  if (maxRetries < 0 || !Number.isFinite(maxRetries)) {
    throw new TypeError('withRetry: maxRetries must be a non-negative finite number');
  }

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // HIGH FIX #6: Wrap in try-catch to handle both sync and async errors
      const result = fn();
      // Handle case where fn returns a non-promise (shouldn't happen with proper typing, but be safe)
      if (result && typeof (result as Promise<T>).then === 'function') {
        return await result;
      }
      return result as T;
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
      logger.info(
        `Retry ${attempt + 1}/${maxRetries} after ${Math.round(actualDelay)}ms: ${lastError.message}`
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

// ============================================================================
// Mutex for Async Operations (CRITICAL FIX #1)
// ============================================================================

/**
 * Promise-based mutex for preventing race conditions in async operations.
 * Provides true mutual exclusion using a promise queue.
 */
export class Mutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  /**
   * Check if the mutex is currently locked (for diagnostics only)
   */
  get isLocked(): boolean {
    return this._locked;
  }

  /**
   * Acquire the mutex lock. Returns a release function.
   * If the mutex is already locked, waits until it becomes available.
   */
  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => this.release());
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  /**
   * Release the mutex lock, allowing the next waiter to proceed.
   */
  private release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      // Schedule next acquisition on next tick to prevent stack overflow
      if (next) {
        queueMicrotask(next);
      }
    } else {
      this._locked = false;
    }
  }

  /**
   * Execute a function with the mutex held.
   * Automatically releases the mutex when done (even on error).
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// ============================================================================
// LRU Cache (CRITICAL FIX #2)
// ============================================================================

/**
 * Least Recently Used (LRU) cache with optional TTL.
 * Prevents unbounded memory growth by evicting oldest entries.
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number | null;

  /**
   * @param maxSize - Maximum number of entries (default: 1000)
   * @param ttlMs - Time-to-live in ms, null for no expiry (default: null)
   */
  constructor(maxSize = 1000, ttlMs: number | null = null) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (this.ttlMs !== null && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * Evicts oldest entry if at capacity.
   */
  set(key: K, value: V): void {
    // Delete first to update position if exists
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Check if a key exists (and is not expired).
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove all expired entries (useful for periodic cleanup).
   */
  prune(): number {
    if (this.ttlMs === null) {
      return 0;
    }

    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }
}

// ============================================================================
// Rkey Validation (HIGH FIX #5)
// ============================================================================

/**
 * Validate an AT Protocol record key (rkey).
 * Valid rkeys are TIDs (timestamp identifiers) or special values.
 * @param rkey - The record key to validate
 * @returns true if valid, false otherwise
 */
export function isValidRkey(rkey: string): boolean {
  if (!rkey || typeof rkey !== 'string') return false;
  // TIDs are base32-sortable, typically 13 chars
  // Also allow 'self' for profile records
  // Format: alphanumeric, dots, underscores, tildes, hyphens (URL-safe)
  if (rkey.length > 512) return false; // Reasonable max length
  return /^[a-zA-Z0-9._~-]+$/.test(rkey);
}

/**
 * Safely extract rkey from an AT Protocol URI.
 * Returns null if URI is invalid or rkey cannot be extracted.
 * @param uri - The AT URI (at://did/collection/rkey)
 * @returns The rkey if valid, null otherwise
 */
export function extractRkeyFromUri(uri: string): string | null {
  if (!uri || typeof uri !== 'string') return null;

  // Parse the URI
  const match = uri.match(/^at:\/\/did:[^/]+\/[^/]+\/([^/?#]+)$/);
  if (!match) return null;

  const rkey = match[1];
  if (!isValidRkey(rkey)) {
    logger.warn('Invalid rkey extracted from URI:', uri);
    return null;
  }

  return rkey;
}

// ============================================================================
// Secure Handle Matching (HIGH FIX #7)
// ============================================================================

/**
 * Check if text contains a mention of a specific handle.
 * Uses word-boundary matching to prevent false positives.
 * @param text - The text to search
 * @param handle - The handle to look for (without @)
 * @returns true if the handle is mentioned
 */
export function textContainsMention(text: string, handle: string): boolean {
  if (!text || !handle || typeof text !== 'string' || typeof handle !== 'string') {
    return false;
  }

  // Normalize both to lowercase
  const normalizedText = text.toLowerCase();
  const normalizedHandle = handle.toLowerCase();

  // Escape special regex characters in handle
  const escapedHandle = normalizedHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match @handle with word boundary after (space, punctuation, end of string)
  // This prevents @alice.bsky.social from matching @alice.bsky.social-fake
  const mentionRegex = new RegExp(`@${escapedHandle}(?=[\\s.,!?;:'"\\)\\]}>]|$)`, 'i');

  return mentionRegex.test(normalizedText);
}

// ============================================================================
// Request Deduplication (MEDIUM FIX #13)
// ============================================================================

/**
 * Deduplicates concurrent requests for the same key.
 * If a request is already in-flight, returns the existing promise.
 */
export class RequestCoalescer<K, V> {
  private pending = new Map<K, Promise<V>>();

  /**
   * Execute a function, deduplicating concurrent calls with the same key.
   * @param key - Unique key for deduplication
   * @param fn - Async function to execute
   * @returns Result of the function
   */
  async execute(key: K, fn: () => Promise<V>): Promise<V> {
    // Check if there's already a pending request for this key
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    // Create new request and track it
    const promise = fn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Check if a request is currently pending for a key.
   */
  isPending(key: K): boolean {
    return this.pending.has(key);
  }

  /**
   * Get count of pending requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
