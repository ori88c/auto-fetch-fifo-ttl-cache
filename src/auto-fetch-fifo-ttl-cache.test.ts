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

import { IAutoFetchFIFOCacheOptions } from './auto-fetch-fifo-ttl-cache.interfaces';
import { AutoFetchFIFOCache } from './auto-fetch-fifo-ttl-cache';

/**
 * Note:
 * Fundamental TTL-FIFO cache guarantees are not revalidated in these tests,
 * as they are provided by the underlying 'fifo-ttl-cache' dependency,
 * which has been thoroughly tested separately:
 * https://github.com/ori88c/fifo-ttl-cache/blob/main/src/fifo-ttl-cache.test.ts
 */

type PromiseResolveCallback<CacheValueType> = (value: CacheValueType) => void;
type PromiseRejectCallback = (reason: Error) => void;

/**
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const triggerEventLoop = () => Promise.resolve();

describe('AutoFetchFIFOCache tests', () => {
  describe('Happy path tests', () => {
    test('concurrent fetches of distinct keys with intermediate state validation', async () => {
      // Arrange.
      const cacheCapacity = 37;
      const numberOfKeys = 2 * cacheCapacity;
      // Keys are: 0, 1, ..., numberOfKeys - 1
      const keys = new Array(numberOfKeys).fill(0).map((_, index) => index.toString());
      const fetchResolvers: PromiseResolveCallback<string>[] = [];
      const getOrFetchPromises: Promise<string>[] = [];
      const cacheOptions: IAutoFetchFIFOCacheOptions<string> = {
        capacity: cacheCapacity,
        ttlMs: 4000,
        fetchValue: () => new Promise<string>((res) => fetchResolvers.push(res)),
      };
      const cache = new AutoFetchFIFOCache<string>(cacheOptions);

      // Act: initiate fetches for all keys one by one.
      let expectedOngoingFetchCount = 0;
      for (const key of keys) {
        getOrFetchPromises.push(cache.getOrFetch(key));
        ++expectedOngoingFetchCount;
        await triggerEventLoop();

        // Assert intermediate state before each fetch resolves.
        expect(cache.has(key)).toBe(false);
        expect(cache.isEmpty).toBe(true);
        expect(cache.size).toBe(0);
        expect(cache.ongoingFetchAttemptsCount).toBe(expectedOngoingFetchCount);
      }

      expect(fetchResolvers.length).toBe(keys.length);
      expect(getOrFetchPromises.length).toBe(keys.length);

      // Track whether all fetches have completed.
      let allFetchesCompleted = false;
      const waitForAllFetches: Promise<void> = (async () => {
        await cache.waitForActiveFetchesToComplete();
        allFetchesCompleted = true;
      })();

      // Resolve fetches one by one and validate cache state.
      let expectedCacheSize = 0;
      for (let i = 0; i < numberOfKeys; ++i) {
        const key = keys[i];
        const value = key; // Using key as the value for simplicity.
        const resolveFetch = fetchResolvers[i];
        const getOrFetchPromise = getOrFetchPromises[i];

        resolveFetch(value);
        await Promise.race([waitForAllFetches, getOrFetchPromise]);
        expect(await getOrFetchPromise).toBe(value);

        --expectedOngoingFetchCount;
        expectedCacheSize = Math.min(1 + expectedCacheSize, cacheCapacity);

        // Assert cache state after each fetch resolves.
        expect(cache.has(key)).toBe(true);
        expect(cache.isEmpty).toBe(false);
        expect(cache.size).toBe(expectedCacheSize);
        expect(cache.ongoingFetchAttemptsCount).toBe(expectedOngoingFetchCount);

        if (i >= cacheCapacity) {
          const evictedKey = (i - cacheCapacity).toString();
          expect(cache.has(evictedKey)).toBe(false);
        }

        expect(allFetchesCompleted).toBe(expectedOngoingFetchCount === 0);
      }

      // Final assertions.
      await waitForAllFetches;
      expect(allFetchesCompleted).toBe(true);
      expect(cache.size).toBe(cacheCapacity);
      expect(cache.ongoingFetchAttemptsCount).toBe(0);

      // Clear the cache and verify final state.
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.isEmpty).toBe(true);
    });

    // prettier-ignore
    test(
      'concurrent requests for the same key should share a single fetch to avoid ' +
      'redundant network calls',
      async () => {
        // Arrange.
        type ValueType = Record<string, string>;
        const key = 'mock key';
        const value: ValueType = { prop1: 'mock value1', prop2: 'mock value2' };
        let fetchResolver: PromiseResolveCallback<ValueType>;
        const getOrFetchPromises: Promise<ValueType>[] = [];
        const fetchValue = jest
          .fn()
          .mockImplementation(() => new Promise<ValueType>((res) => (fetchResolver = res)));

        const cacheOptions: IAutoFetchFIFOCacheOptions<ValueType> = {
          capacity: 5,
          ttlMs: 1000,
          fetchValue,
        };
        const cache = new AutoFetchFIFOCache<ValueType>(cacheOptions);

        expect(fetchValue).not.toHaveBeenCalled();
        expect(cache.ongoingFetchAttemptsCount).toBe(0);

        // Act: fire many concurrent getOrFetch calls for the same key.
        const concurrentAttemptsCount = 215;
        for (let attempt = 0; attempt < concurrentAttemptsCount; ++attempt) {
          getOrFetchPromises.push(cache.getOrFetch(key));
        }

        await Promise.race([...getOrFetchPromises, triggerEventLoop()]);

        // Assert intermediate state before resolution.
        expect(cache.has(key)).toBe(false);
        expect(cache.isEmpty).toBe(true);
        expect(cache.size).toBe(0);
        expect(cache.ongoingFetchAttemptsCount).toBe(1);
        expect(fetchValue).toHaveBeenCalledTimes(1);
        expect(fetchValue).toHaveBeenCalledWith(key);

        // Resolve the ongoing fetch.
        fetchResolver(value);
        await Promise.all(getOrFetchPromises);
        expect(cache.ongoingFetchAttemptsCount).toBe(0);
        expect(cache.size).toBe(1);

        // Assert: all fetch calls should return the same object reference.
        for (const fetchPromise of getOrFetchPromises) {
          expect(await fetchPromise).toBe(value); // Reference equality check
        }
      },
    );
  });

  describe('Negative path tests', () => {
    test('should propagate the fetch error to the caller when a fetch attempt fails', async () => {
      // Arrange.
      const cacheCapacity = 48;
      const numberOfKeys = 3 * cacheCapacity;
      // Keys are: 0, 1, ..., numberOfKeys - 1
      const keys = new Array(numberOfKeys).fill(0).map((_, index) => index.toString());
      const errors = keys.map((key) => new Error(key));
      const fetchRejectors: PromiseRejectCallback[] = [];
      const getOrFetchPromises: Promise<string>[] = [];
      const cacheOptions: IAutoFetchFIFOCacheOptions<string> = {
        capacity: cacheCapacity,
        ttlMs: 3000,
        fetchValue: () => new Promise<string>((_, rej) => fetchRejectors.push(rej)),
      };
      const cache = new AutoFetchFIFOCache<string>(cacheOptions);

      // Act: initiate fetches for all keys one by one.
      let expectedOngoingFetchCount = 0;
      for (const key of keys) {
        getOrFetchPromises.push(cache.getOrFetch(key));
        ++expectedOngoingFetchCount;
        await triggerEventLoop();

        // Assert intermediate state before each fetch resolves.
        expect(cache.has(key)).toBe(false);
        expect(cache.isEmpty).toBe(true);
        expect(cache.size).toBe(0);
        expect(cache.ongoingFetchAttemptsCount).toBe(expectedOngoingFetchCount);
      }

      expect(fetchRejectors.length).toBe(keys.length);
      expect(getOrFetchPromises.length).toBe(keys.length);

      // Track whether all fetches have completed (rejected).
      let allFetchesCompleted = false;
      const waitForAllFetches: Promise<void> = (async () => {
        await cache.waitForActiveFetchesToComplete();
        allFetchesCompleted = true;
      })();

      // Reject fetches one by one and validate cache state.
      for (let i = 0; i < numberOfKeys; ++i) {
        const key = keys[i];
        const error = errors[i];
        const rejectFetch = fetchRejectors[i];
        const getOrFetchPromise = getOrFetchPromises[i];

        rejectFetch(error);
        await expect(getOrFetchPromise).rejects.toThrow(error);

        --expectedOngoingFetchCount;

        // Assert cache state after each fetch resolves.
        expect(cache.has(key)).toBe(false);
        expect(cache.isEmpty).toBe(true);
        expect(cache.size).toBe(0);
        expect(cache.ongoingFetchAttemptsCount).toBe(expectedOngoingFetchCount);
        expect(allFetchesCompleted).toBe(expectedOngoingFetchCount === 0);
      }

      // Final assertions.
      await waitForAllFetches;
      expect(allFetchesCompleted).toBe(true);
      expect(cache.size).toBe(0);
      expect(cache.ongoingFetchAttemptsCount).toBe(0);
    });
  });
});
