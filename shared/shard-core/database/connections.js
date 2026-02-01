/**
 * Database Connections
 * Factory functions for creating PostgreSQL pool and Redis client
 */

const redis = require('redis');
const pg = require('pg');

/**
 * Create PostgreSQL connection pool
 */
function createPostgresPool(config) {
  const {
    DB_HOST = 'postgres',
    DB_PORT = 5432,
    DB_NAME = 'whatsapp',
    DB_USER = 'postgres',
    DB_PASSWORD = 'postgres',
    SHARD_ID = '1'
  } = config;

  const pool = new pg.Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD
  });

  pool.on('error', (err) => {
    console.error(`[SHARD-${SHARD_ID}] PostgreSQL connection error:`, err.message);
  });

  return pool;
}

/**
 * Create Redis client
 */
async function createRedisClient(config) {
  const {
    REDIS_URL = 'redis://redis:6379',
    SHARD_ID = '1'
  } = config;

  const client = redis.createClient({ url: REDIS_URL });
  
  client.on('error', (err) => {
    console.error(`[SHARD-${SHARD_ID}] Redis connection error:`, err.message);
  });

  await client.connect();
  console.log(`[SHARD-${SHARD_ID}] Connected to Redis`);

  return client;
}

module.exports = {
  createPostgresPool,
  createRedisClient
};
