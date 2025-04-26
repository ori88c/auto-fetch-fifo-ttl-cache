/**
 * Copyright 2025 Ori Cohen https://github.com/ori88c
 * https://github.com/ori88c/auto-fetch-fifo-ttl-cache
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FIFOCache } from 'fifo-ttl-cache';
import { ZeroOverheadKeyedLock } from 'zero-overhead-keyed-promise-lock';
import { IAutoFetchFIFOCacheOptions } from './auto-fetch-fifo-ttl-cache.interfaces';

/**
 * The `AutoFetchFIFOCache` class implements a FIFO-based cache with automated value fetching,
 * streamlining the typical get-or-fetch pattern and allowing developers to focus on core business
 * logic.
 *
 * Rather than requiring separate `get` and `set` operations, the cache provides the `getOrFetch`
 * method, which encapsulates the entire flow:
 * - Check if the key exists in the cache.
 * - If it exists, return the cached value.
 * - If not, fetch the value asynchronously (e.g., from a remote service), cache the result, and
 *   return it.
 *
 * ### Concurrent Fetch Handling
 * To prevent redundant fetches for the same key during high-concurrency scenarios, the class uses
 * a keyed lock mechanism. When multiple `getOrFetch` calls are made concurrently for the same missing
 * key, only one fetch operation is executed. All callers await the same in-flight promise, reducing
 * unnecessary network traffic and minimizing the risk of rate-limiting or throttling errors.
 *
 * ## FIFO Cache Use Cases
 * Unlike the widely used LRU Cache, a FIFO Cache does **not** prioritize keeping popular keys cached
 * for extended durations. This simplicity reduces implementation overhead and generally offers faster
 * response times.
 * FIFO caches are particularly suitable when **freshness** (up-to-date values) is critical, such as in
 * security-sensitive scenarios, or when key popularity is uniform and predictable.
 *
 * ### Underlying Components
 * This class composes well-tested, single-responsibility utilities:
 * - [fifo-ttl-cache](https://www.npmjs.com/package/fifo-ttl-cache):
 *   for FIFO-based cache eviction with TTL support.
 * - [zero-overhead-keyed-promise-lock](https://www.npmjs.com/package/zero-overhead-keyed-promise-lock):
 *   for efficient keyed locking of asynchronous operations.
 */
export class AutoFetchFIFOCache<ValueType> {
  private readonly _lock = new ZeroOverheadKeyedLock<ValueType>();
  private readonly _fifoCache: FIFOCache<string, ValueType>;
  private readonly _fetchValue: (key: string) => Promise<ValueType>;

  constructor(options: Readonly<IAutoFetchFIFOCacheOptions<ValueType>>) {
    const { capacity, ttlMs, fetchValue } = options;
    this._fifoCache = new FIFOCache<string, ValueType>(capacity, ttlMs);
    this._fetchValue = fetchValue;
  }

  /**
   * @returns The number of items currently stored in this instance.
   */
  public get size(): number {
    return this._fifoCache.size;
  }

  /**
   * @returns True if and only if the cache does not contain any entry.
   */
  public get isEmpty(): boolean {
    return this._fifoCache.isEmpty;
  }

  /**
   * @returns The number of fetch attempts currently in progress. This reflects the number of
   *          active `getOrFetch` calls that are awaiting a fetch operation for keys that are
   *          not already in the cache.
   */
  public get ongoingFetchAttemptsCount(): number {
    return this._lock.activeKeysCount;
  }

  /**
   * Retrieves the value associated with the given key from the cache, or fetches and stores
   * it if not already present.
   *
   * This method encapsulates the common get-or-fetch pattern:
   * - If the key exists in the cache and has not expired, the cached value is returned.
   * - If the key is missing or expired, the value is fetched asynchronously using the
   *   user-provided `fetchValue` function, stored in the cache, and then returned.
   *
   * ### Concurrent Fetch Handling
   * To prevent redundant fetches for the same key during high-concurrency scenarios, the class uses
   * a keyed lock mechanism. When multiple `getOrFetch` calls are made concurrently for the same missing
   * key, only one fetch operation is executed. All callers await the same in-flight promise, reducing
   * unnecessary network traffic and minimizing the risk of rate-limiting or throttling errors.
   *
   * ### ⚠️ Error Handling
   * If the fetcher throws or returns a rejected promise, the corresponding `getOrFetch` call
   * will also reject, and **no value will be cached** for the key. This behavior mirrors the
   * manual workflow of fetching a value before explicitly storing it via `set`, allowing
   * developers to retain full control over error-handling strategies.
   * The cache remains agnostic to how errors should be handled. If desired, the fetcher itself
   * may implement fallback logic - such as returning a default value or a sentinel object
   * representing failure - depending on the needs of the application.
   *
   * @param key The unique identifier for the cached entry.
   * @returns A promise resolving to the value associated with the key - either retrieved
   *          from cache or freshly fetched.
   * @throws If the value could not be retrieved and the fetch operation failed.
   */
  public async getOrFetch(key: string): Promise<ValueType> {
    let value = this._fifoCache.get(key);
    if (value) {
      return value;
    }

    // If another fetch is already in progress for this key, await the ongoing task to avoid
    // redundant network requests.
    const ongoingFetch = this._lock.getCurrentExecution(key);
    if (ongoingFetch) {
      value = await ongoingFetch;
    } else {
      value = await this._lock.executeExclusive(key, () => this._fetchValue(key));
      this._fifoCache.set(key, value);
    }

    return value;
  }

  /**
   * Determines whether the cache contains a valid, non-expired entry for the
   * specified key.
   *
   * ## Use Cases
   * This method is particularly useful when the cache is employed as a Set-like
   * structure, where the presence of a key is significant but the associated
   * value is secondary or unnecessary.
   *
   * ### Example
   * In an authentication system, this method can be used to determine whether
   * a user's session token is still active without needing to retrieve the
   * token's associated metadata or details.
   *
   * @param key The unique identifier for the cached entry.
   * @returns `true` if the cache contains a non-expired entry for the key;
   *          otherwise, `false`.
   *
   * @remarks
   * This method ensures that expired entries are treated as non-existent,
   * helping to maintain cache integrity by verifying both the presence and
   * validity of the entry before returning the result.
   */
  public has(key: string): boolean {
    return this._fifoCache.has(key);
  }

  /**
   * Removes the cached entry associated with the specified key, if such a entry
   * exists in the cache.
   *
   * ## Return Value Clarification
   * Due to the event-driven eviction mechanism (see class documentation for details),
   * the `delete` method may return `true` for an outdated key that remains in the cache.
   * This occurs because a key's expiration is validated only during `getOrFetch` or `has`
   * operations, not when calling `delete`.
   *
   * @param key The unique identifier for the cached entry.
   * @returns `true` if the key existed in the cache (whether up-to-date or outdated);
   *          `false` otherwise.
   */
  public delete(key: string): boolean {
    return this._fifoCache.delete(key);
  }

  /**
   * Removes all entries from the cache, leaving it empty.
   */
  public clear(): void {
    this._fifoCache.clear();
  }

  /**
   * Waits for the completion of all active fetch attempts.
   *
   * This method is particularly useful in scenarios where it is essential to ensure that
   * all tasks are fully processed before proceeding.
   * Examples include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications)
   * or maintaining a clear state between unit tests.
   * This need is especially relevant in Kubernetes ReplicaSet deployments. When an HPA controller
   * scales down, pods begin shutting down gracefully.
   *
   * ### Graceful Teardown
   * The returned promise only accounts for fetches that were already in progress at the time this
   * method was called. It does **not** track fetches started afterward.
   * If there's a possibility that new fetches could be triggered concurrently, consider using the
   * following loop to wait until all fetches have fully settled:
   * ```ts
   * while (autoFetchCache.ongoingFetchAttemptsCount > 0) {
   *   await autoFetchCache.waitForActiveFetchesToComplete()
   * }
   * ```
   *
   * ### Never Throws
   * This method never rejects, even if any of the active fetch attempts fail.
   *
   * @returns A promise that resolves once all active fetch attempts at the time of invocation
   *          are completed. For clarity, *completion* refers to each task either resolving or rejecting.
   */
  public waitForActiveFetchesToComplete(): Promise<void> {
    return this._lock.waitForAllExistingTasksToComplete();
  }
}
