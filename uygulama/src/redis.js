const { createClient } = require('redis');

const client = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT || 6379)
  }
});

client.on('error', (error) => {
  console.error('Redis bağlantı hatası:', error.message);
});

async function connectRedis() {
  if (!client.isOpen) await client.connect();
}

async function closeRedis() {
  if (client.isOpen) await client.quit();
}

module.exports = { client, connectRedis, closeRedis };
