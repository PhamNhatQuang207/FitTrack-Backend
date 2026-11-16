class MemoryCache {
  constructor({ maxEntries = 200, defaultTtlMs = 5 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh insertion order so recently read keys stay hot (O(1) LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    return value;
  }

  del(key) {
    return this.store.delete(key);
  }

  delByPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (String(key).startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

const publicDataCache = new MemoryCache({ maxEntries: 100, defaultTtlMs: 5 * 60 * 1000 });
const ragEmbeddingCache = new MemoryCache({ maxEntries: 100, defaultTtlMs: 30 * 60 * 1000 });
const ragChunksCache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 15 * 60 * 1000 });

const clearAllCaches = () => {
  publicDataCache.clear();
  ragEmbeddingCache.clear();
  ragChunksCache.clear();
};

module.exports = {
  MemoryCache,
  publicDataCache,
  ragEmbeddingCache,
  ragChunksCache,
  clearAllCaches,
};
