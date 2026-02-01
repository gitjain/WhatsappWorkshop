/**
 * Shard-1 Server
 * Uses the shared shard-core logic
 * This keeps the code in one place for easy maintenance
 */

const { createShardServer } = require('./shard-core.js');

// Get configuration from environment variables
const shardConfig = {
  SHARD_ID: process.env.SHARD_ID || '1',
  PORT: process.env.PORT || 4001,
  REDIS_URL: process.env.REDIS_URL || 'redis://redis:6379',
  DB_HOST: process.env.DB_HOST || 'postgres',
  DB_PORT: process.env.DB_PORT || 5432,
  DB_NAME: process.env.DB_NAME || 'whatsapp',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres'
};

// Create and start the shard server
createShardServer(shardConfig);
