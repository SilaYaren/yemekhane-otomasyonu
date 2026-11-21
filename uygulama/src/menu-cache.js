const { createHash } = require('node:crypto');
const { client } = require('./redis');

const CACHE_PREFIX = 'yemekhane:menu:v1:';
const REGISTRY_KEY = 'yemekhane:menu:v1:keys';
const VERSION_KEY = 'yemekhane:menu:v1:version';

const STORE_SCRIPT = `
  if (redis.call('GET', KEYS[1]) or '0') ~= ARGV[1] then
    return 0
  end
  redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
  redis.call('SADD', KEYS[3], KEYS[2])
  redis.call('EXPIRE', KEYS[3], ARGV[3])
  return 1
`;

const INVALIDATE_SCRIPT = `
  local keys = redis.call('SMEMBERS', KEYS[1])
  local deleted = 0
  for _, key in ipairs(keys) do
    deleted = deleted + redis.call('DEL', key)
  end
  redis.call('DEL', KEYS[1])
  redis.call('INCR', KEYS[2])
  return deleted
`;

function secondsUntilEndOfDay(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 1000));
}

function descriptorKey(descriptor, version) {
  const params = Object.fromEntries(
    Object.entries(descriptor.params || {}).sort(([left], [right]) => left.localeCompare(right))
  );
  const value = JSON.stringify({
    route: descriptor.route,
    userId: descriptor.userId,
    role: descriptor.role,
    params,
    version
  });
  return `${CACHE_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
}

function createMenuCache(redisClient, logger = console) {
  return {
    async getOrLoad(descriptor, loader) {
      const version = await redisClient.get(VERSION_KEY) || '0';
      const key = descriptorKey(descriptor, version);
      const cached = await redisClient.get(key);
      if (cached !== null) {
        logger.info(`[MENU_CACHE] HIT route=${descriptor.route} key=${key.slice(-12)} source=redis`);
        return JSON.parse(cached);
      }

      logger.info(`[MENU_CACHE] MISS route=${descriptor.route} key=${key.slice(-12)} source=database`);
      const value = await loader();
      const ttl = secondsUntilEndOfDay();
      const stored = await redisClient.eval(STORE_SCRIPT, {
        keys: [VERSION_KEY, key, REGISTRY_KEY],
        arguments: [version, JSON.stringify(value), String(ttl)]
      });

      logger.info(`[MENU_CACHE] ${Number(stored) ? 'STORE' : 'SKIP_STALE_STORE'} route=${descriptor.route} ttl=${ttl}s`);
      return value;
    },

    async invalidate(reason) {
      const deleted = Number(await redisClient.eval(INVALIDATE_SCRIPT, {
        keys: [REGISTRY_KEY, VERSION_KEY],
        arguments: []
      }));
      logger.info(`[MENU_CACHE] INVALIDATED reason=${reason} deleted=${deleted}`);
      return deleted;
    }
  };
}

const menuCache = createMenuCache(client);

module.exports = { createMenuCache, menuCache, secondsUntilEndOfDay };
