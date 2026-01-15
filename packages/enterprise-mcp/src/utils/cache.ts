/**
 * In-Memory Response Cache for Enterprise MCP
 * LRU cache with TTL for frequently accessed data
 */

import { logger } from './logger.js';

export interface CacheEntry<T> {
  data: T;
  expires: number;
  createdAt: number;
  hits: number;
}

export interface CacheOptions {
  /** Maximum number of entries */
  maxSize: number;
  /** Default TTL in milliseconds */
  defaultTtl: number;
  /** Name for logging */
  name: string;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: string;
  oldestEntry?: number;
  newestEntry?: number;
}

export class ResponseCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(private options: CacheOptions) {
    logger.debug('Cache initialized', { name: options.name, maxSize: options.maxSize });

    // Periodic cleanup of expired entries
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Get an item from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    entry.hits++;
    this.hits++;
    return entry.data;
  }

  /**
   * Set an item in cache
   */
  set(key: string, data: T, ttl?: number): void {
    // Evict if at capacity
    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      expires: now + (ttl || this.options.defaultTtl),
      createdAt: now,
      hits: 0,
    });
  }

  /**
   * Get or fetch with cache
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      logger.debug('Cache hit', { cache: this.options.name, key });
      return cached;
    }

    logger.debug('Cache miss, fetching', { cache: this.options.name, key });
    const data = await fetcher();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * Delete an item from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared', { name: this.options.name });
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug('Cache entries invalidated', { cache: this.options.name, pattern: pattern.source, count });
    }
    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const total = this.hits + this.misses;

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(2)}%` : '0%',
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.createdAt)) : undefined,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.createdAt)) : undefined,
    };
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expires) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cache cleanup', { cache: this.options.name, removed });
    }
  }

  /**
   * Evict oldest entry (LRU)
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug('Cache eviction', { cache: this.options.name, key: oldestKey });
    }
  }
}

/**
 * Generate cache key from request parameters
 */
export function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&');

  return `${prefix}:${sortedParams}`;
}

// Pre-configured caches
export const memoryListCache = new ResponseCache({
  name: 'memoryList',
  maxSize: 100,
  defaultTtl: 30000, // 30 seconds - list data changes frequently
});

export const statsCache = new ResponseCache({
  name: 'stats',
  maxSize: 20,
  defaultTtl: 60000, // 1 minute
});
