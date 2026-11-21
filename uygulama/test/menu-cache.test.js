const test = require('node:test');
const assert = require('node:assert/strict');
const { createMenuCache, secondsUntilEndOfDay } = require('../src/menu-cache');

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.sets = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async eval(_script, { keys, arguments: args }) {
    if (keys.length === 3) {
      const [versionKey, cacheKey, registryKey] = keys;
      const [version, value] = args;
      if ((this.values.get(versionKey) || '0') !== version) return 0;
      this.values.set(cacheKey, value);
      if (!this.sets.has(registryKey)) this.sets.set(registryKey, new Set());
      this.sets.get(registryKey).add(cacheKey);
      return 1;
    }

    const [registryKey, versionKey] = keys;
    const cacheKeys = this.sets.get(registryKey) || new Set();
    for (const key of cacheKeys) this.values.delete(key);
    this.sets.delete(registryKey);
    this.values.set(versionKey, String(Number(this.values.get(versionKey) || 0) + 1));
    return cacheKeys.size;
  }
}

test('caches a menu result and serves the second request from Redis', async () => {
  const redis = new FakeRedis();
  const cache = createMenuCache(redis, { info() {} });
  let databaseReads = 0;
  const descriptor = { route: 'menus/week', userId: 7, role: 'ogrenci', params: { start: '2026-11-16' } };
  const loader = async () => {
    databaseReads += 1;
    return { menuler: [{ id: 21, fiyat: 40 }] };
  };

  assert.deepEqual(await cache.getOrLoad(descriptor, loader), { menuler: [{ id: 21, fiyat: 40 }] });
  assert.deepEqual(await cache.getOrLoad(descriptor, loader), { menuler: [{ id: 21, fiyat: 40 }] });
  assert.equal(databaseReads, 1);
});

test('invalidating menus removes cached values and the next request reloads them', async () => {
  const redis = new FakeRedis();
  const cache = createMenuCache(redis, { info() {} });
  let databaseReads = 0;
  const descriptor = { route: 'menus/today', userId: 7, role: 'ogrenci', params: { date: '2026-11-21' } };
  const loader = async () => ({ version: ++databaseReads });

  assert.deepEqual(await cache.getOrLoad(descriptor, loader), { version: 1 });
  assert.equal(await cache.invalidate('admin-menu-saved'), 1);
  assert.deepEqual(await cache.getOrLoad(descriptor, loader), { version: 2 });
  assert.equal(databaseReads, 2);
});

test('does not store an old database read after a concurrent invalidation', async () => {
  const redis = new FakeRedis();
  const events = [];
  const cache = createMenuCache(redis, { info: (event) => events.push(event) });
  let releaseRead;
  let markReadStarted;
  const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
  const descriptor = { route: 'menus/today', userId: 7, role: 'ogrenci', params: { date: '2026-11-21' } };
  const oldRequest = cache.getOrLoad(descriptor, () => {
    markReadStarted();
    return new Promise((resolve) => { releaseRead = resolve; });
  });

  await readStarted;
  await cache.invalidate('admin-menu-saved');
  releaseRead({ version: 'old' });
  assert.deepEqual(await oldRequest, { version: 'old' });
  assert.ok(events.some((event) => event.includes('SKIP_STALE_STORE')));

  assert.deepEqual(await cache.getOrLoad(descriptor, async () => ({ version: 'new' })), { version: 'new' });
});

test('menu cache keys keep user-specific responses separate', async () => {
  const redis = new FakeRedis();
  const cache = createMenuCache(redis, { info() {} });
  let databaseReads = 0;
  const base = { route: 'menus/week', role: 'ogrenci', params: { start: '2026-11-16' } };

  await cache.getOrLoad({ ...base, userId: 7 }, async () => ({ user: ++databaseReads }));
  await cache.getOrLoad({ ...base, userId: 8 }, async () => ({ user: ++databaseReads }));
  assert.equal(databaseReads, 2);
});

test('menu cache TTL ends at Istanbul midnight', () => {
  const now = new Date('2026-11-21T15:00:00+03:00');
  assert.equal(secondsUntilEndOfDay(now), 9 * 60 * 60);
});
