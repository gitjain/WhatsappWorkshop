/**
 * Database Replication Manager
 * Syncs data from primary database to backup database
 * Runs periodically on each shard
 */

const { Pool } = require('pg');

class ReplicationManager {
  constructor(shardId, primaryDB, backupDB) {
    this.shardId = shardId;
    this.primaryPool = new Pool(primaryDB);
    this.backupPool = new Pool(backupDB);
    this.syncInterval = 5000; // Sync every 5 seconds
  }

  async initialize() {
    try {
      await this.primaryPool.query('SELECT 1');
      console.log(`[REPLICATION-${this.shardId}] Primary database connected`);
      
      await this.backupPool.query('SELECT 1');
      console.log(`[REPLICATION-${this.shardId}] Backup database connected`);
      
      this.startReplication();
    } catch (error) {
      console.error(`[REPLICATION-${this.shardId}] Initialization error:`, error.message);
      setTimeout(() => this.initialize(), 5000); // Retry after 5 seconds
    }
  }

  startReplication() {
    console.log(`[REPLICATION-${this.shardId}] Starting replication sync every ${this.syncInterval}ms`);
    
    setInterval(() => {
      this.syncData();
    }, this.syncInterval);
  }

  async syncData() {
    try {
      // Sync users table
      const usersResult = await this.primaryPool.query('SELECT * FROM users');
      if (usersResult.rows.length > 0) {
        for (const user of usersResult.rows) {
          await this.backupPool.query(
            'INSERT INTO users (id, name, shard_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2, shard_id = $3',
            [user.id, user.name, user.shard_id]
          );
        }
      }

      // Sync messages table - get recent messages
      const messagesResult = await this.primaryPool.query(
        `SELECT * FROM messages 
         WHERE created_at > NOW() - INTERVAL '1 minute'
         ORDER BY created_at DESC`
      );
      
      if (messagesResult.rows.length > 0) {
        for (const msg of messagesResult.rows) {
          await this.backupPool.query(
            `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) 
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET content = $4`,
            [msg.id, msg.from_user_id, msg.to_user_id, msg.content, msg.created_at, msg.shard_id]
          );
        }
      }

      console.log(`[REPLICATION-${this.shardId}] Sync completed - Users: ${usersResult.rows.length}, Recent Messages: ${messagesResult.rows.length}`);
    } catch (error) {
      console.error(`[REPLICATION-${this.shardId}] Replication error:`, error.message);
    }
  }

  async close() {
    await this.primaryPool.end();
    await this.backupPool.end();
  }
}

module.exports = { ReplicationManager };
