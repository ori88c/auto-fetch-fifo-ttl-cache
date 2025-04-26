<h2 align="middle">auto-fetch-fifo-ttl-cache</h2>

An in-memory FIFO cache with fixed TTL for Node.js, designed to **streamline the common get-or-fetch pattern** by automating value retrieval. It uses an internal keyed lock to coalesce concurrent fetches for the same key, reducing redundant network calls and eliminating synchronization overhead for developers.

Special emphasis is given to **graceful teardown**: The ability to await the completion of all active fetch attempts - particularly during application shutdown - makes it ideal for production environments requiring seamless resource cleanup.

## Table of Contents

* [Key Features](#key-features)
* [API](#api)
* [Getter Methods](#getter-methods)
* [Use Case Example: Threat Intelligence IP Reputation Lookup](#use-case-example)
* [Error Handling](#error-handling)
* [FIFO vs LRU cache](#fifo-vs-lru)
* [License](#license)

## Key Features :sparkles:<a id="key-features"></a>

- __FIFO Cache :package:__: Automatically evicts the oldest entry (based on insertion time) when the cache reaches its capacity and a new entry with a non-existing key is added, **irrespective of the entry’s popularity**. Compared to LRU cache variants, FIFO offers faster response times in scenarios such as: short-term key popularity, uniform key access patterns, or when the cache size closely matches the total number of possible keys. It is also well suited for security-sensitive use cases or environments where data freshness is critical.
- __Fixed TTL :lock:__: Ensures all cached entries share the same Time-to-Live (TTL) duration, allowing for automatic eviction of stale entries.
- __Automated Value Fetching :gear:__: The `getOrFetch` method streamlines the common **get-or-fetch pattern**, allowing developers to focus on core business logic. A value is fetched only if the key is missing or has expired; otherwise, the cached value is returned.
- __Concurrent Fetch Handling 🤹__: To prevent redundant fetches for the same key during high-concurrency scenarios, the class uses a keyed lock mechanism. When multiple `getOrFetch` calls are made concurrently for the same missing key, only one fetch operation is executed. All callers await the same in-flight promise, reducing unnecessary network traffic and minimizing the risk of rate-limiting or throttling errors.
- __Graceful Teardown :hourglass_flowing_sand:__: Await the completion of all active fetch attempts using the `waitForActiveFetchesToComplete` method. Example use cases include application shutdowns (e.g., `onModuleDestroy` in [NestJS](https://www.npmjs.com/package/@nestjs/common) applications) or maintaining a clear state between unit-tests.
- __Efficiency :dash:__: JavaScript's `Map` maintains the insertion order of keys, offering a reliable and **often overlooked** guarantee for iteration. The underlying [fifo-ttl-cache](https://www.npmjs.com/package/fifo-ttl-cache) package leverages this guarantee to eliminate the need for manually managing insertion order during evictions.
- __Comprehensive Documentation :books:__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Tests :test_tube:__: **Fully covered** by comprehensive unit tests. Both dependencies are maintained by the same author and are thoroughly tested as well.
- __ES2020 Compatibility__: The project targets ES2020 for modern JavaScript support.
- __Full TypeScript Support__: Designed for seamless TypeScript integration.

## API :globe_with_meridians:<a id="api"></a>

The `AutoFetchFIFOCache` class provides the following methods:

* __getOrFetch__: This method encapsulates the common get-or-fetch pattern.
  * If the key exists in the cache and has not expired, the cached value is returned.
  * If the key is missing or expired, the value is fetched asynchronously using the user-provided `fetchValue` function, stored in the cache, and then returned.
* __has__: Determines whether the cache contains a valid, non-expired entry for the specified key. This method is particularly useful when the cache is employed as a Set-like structure, where the presence of a key is significant but the associated value is secondary or unnecessary.
* __delete__: Removes the cached entry associated with the specified key, if such a entry exists in the cache.
* __clear__: Removes all entries from the cache, leaving it empty.
* __waitForActiveFetchesToComplete__: Waits for the completion of all active fetch attempts. This method is particularly useful in scenarios where it is essential to ensure that all tasks are fully processed before proceeding. Examples include **application shutdowns** (e.g., `onModuleDestroy` in [NestJS](https://www.npmjs.com/package/@nestjs/common) applications) or maintaining a clear state between unit tests. This need is especially relevant in Kubernetes ReplicaSet deployments. When an HPA controller scales down, pods begin shutting down gracefully.

If needed, refer to the code documentation for a more comprehensive description of each method.

## Getter Methods :mag:<a id="getter-methods"></a>

The `AutoFetchFIFOCache` class provides the following getter methods to reflect the current activity state:

* __size__: The number of items currently stored in this instance.
* __isEmpty__: True if and only if the cache does not contain any entry.
* __ongoingFetchAttemptsCount__: The number of fetch attempts currently in progress. This reflects the number of active `getOrFetch` calls that are awaiting a fetch operation for keys that are not already in the cache.

## Use Case Example: Threat Intelligence IP Reputation Lookup :shield:<a id="use-case-example"></a>

Intrusion detection systems often cache reputation data for IP addresses from a remote threat intelligence API. Threat intel lookups are expensive (latency, rate limits, cost), so caching improves performance and reduces load.

IP addresses tend to exhibit **short-term behavioral consistency** (e.g., a botnet or scanner using an IP will often keep using it for hours or days). In other words, IP ownership or usage can shift rapidly, especially with cloud providers or DHCP. Therefore, TTL must be short (e.g., minutes to a few hours).

The following `IPRiskAssessor` component encapsulates both fetching and caching of IP risk assessments. This abstraction adheres to the single-responsibility principle, and facilitates unit testing by making the external dependency easy to mock:
```ts
import {
  IAutoFetchFIFOCacheOptions,
  AutoFetchFIFOCache
} from 'auto-fetch-fifo-ttl-cache';

const CACHE_CAPACITY = 2048;
const CACHE_TTL_MS = 1000 * 60 * 5;

interface IReputationInfo {
  riskLevel: 'low' | 'medium' | 'high';
  categories: string[];
  lastUpdated: Date;
}

class IPRiskAssessor {
  private readonly _ipToRiskCache: AutoFetchFIFOCache<IReputationInfo>;

  constructor() {
    const options: IAutoFetchFIFOCacheOptions = {
      capacity: CACHE_CAPACITY,
      ttlMs: CACHE_TTL_MS,
      fetchValue: this._fetchFromThreatIntel.bind(this)
      // Alternatively, define the value fetcher using an arrow function:
      // (ip: string): Promise<ReputationInfo> => this._fetchFromThreatIntel(ip)
    };
    this._ipToRiskCache = new AutoFetchFIFOCache<IReputationInfo>(options);
  }

  public async getReputation(ip: string): Promise<IReputationInfo> {
    const reputationInfo = await this._ipToRiskCache.getOrFetch(ip);
    return reputationInfo;
  }

  private async _fetchFromThreatIntel(ip: string): Promise<ReputationInfo> {
    // Simulate a remote fetch; in real life, call an external API here.
  }
}
```

## Error Handling ⚠️<a id="error-handling"></a>

If the fetcher throws or returns a rejected promise, the corresponding `getOrFetch` call will also reject, and **no value will be cached** for the key. This behavior mirrors the manual workflow of fetching a value before explicitly storing it via `set`, allowing developers to retain full control over error-handling strategies.

The cache remains agnostic to how errors should be handled. If desired, the fetcher itself may implement fallback logic - such as returning a default value or a sentinel object representing failure - depending on the needs of the application.

## FIFO vs LRU cache ⚖️<a id="fifo-vs-lru"></a>

Unlike the widely used LRU Cache, a FIFO Cache does not prioritize keeping popular keys cached for extended durations. This simplicity reduces implementation overhead and generally offers **faster response times**. FIFO caches are particularly well-suited for scenarios where:
* __Short-term key popularity__: Useful for situations where certain keys experience brief periods of higher activity (e.g., a 15-minute spike). For instance, in a background service aggregating data from a customer’s IoT sensors, caching customer details during the aggregation process enhances performance without compromising data relevance.
* __Uniform key distribution__: Effective when key popularity is relatively consistent and predictable.
* __Freshness of values is critical__: Ideal for security-sensitive use cases or environments where up-to-date data is essential.
* __The cache size closely matches the total number of potential keys__: In scenarios where most of the possible keys are already cached, eviction due to limited capacity becomes negligible. As a result, the key-reordering mechanism of an LRU Cache offers **little benefit and adds unnecessary overhead**.

## License :scroll:<a id="license"></a>

[Apache 2.0](LICENSE)
