const { MemoryCache, clearAllCaches, publicDataCache } = require('../../src/utils/memoryCache');

describe('MemoryCache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    clearAllCaches();
  });

  test('returns undefined on miss and stored value on hit before TTL', () => {
    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 5000 });
    expect(cache.get('missing')).toBeUndefined();

    cache.set('k1', { ok: true });
    expect(cache.get('k1')).toEqual({ ok: true });
    expect(cache.size()).toBe(1);
  });

  test('expires entries after TTL elapses', () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 1000 });
    cache.set('k1', 'v1');
    expect(cache.get('k1')).toBe('v1');

    now += 1001;
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test('evicts least-recently-used entry when maxEntries is exceeded', () => {
    const cache = new MemoryCache({ maxEntries: 2, defaultTtlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touch 'a' so 'b' becomes least-recently-used
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  test('delByPrefix removes only matching keys', () => {
    const cache = new MemoryCache({ maxEntries: 10, defaultTtlMs: 10000 });
    cache.set('exercises:all', [1]);
    cache.set('exercises:category:Chest', [2]);
    cache.set('muscle-groups:public', [3]);

    cache.delByPrefix('exercises:');
    expect(cache.get('exercises:all')).toBeUndefined();
    expect(cache.get('exercises:category:Chest')).toBeUndefined();
    expect(cache.get('muscle-groups:public')).toEqual([3]);
  });

  test('clearAllCaches flushes shared caches', () => {
    publicDataCache.set('site-config:public', { announcementBanner: 'Hi' });
    expect(publicDataCache.size()).toBe(1);
    clearAllCaches();
    expect(publicDataCache.size()).toBe(0);
  });
});
