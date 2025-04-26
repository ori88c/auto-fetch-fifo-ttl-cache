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

export interface IAutoFetchFIFOCacheOptions<ValueType> {
  /**
   * The maximum number of key-value pairs allowed in the cache.
   */
  capacity: number;

  /**
   * The maximum duration (in milliseconds) after which an inserted key is considered
   * outdated and removed from the cache.
   */
  ttlMs: number;

  /**
   * A user-provided asynchronous function responsible for fetching a value when a key is not
   * found in the cache. This function is internally invoked by the `getOrFetch` method.
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
   * @param key The cache key whose value needs to be fetched.
   * @returns A promise resolving to the value associated with the given key.
   */
  fetchValue: (key: string) => Promise<ValueType>;
}
