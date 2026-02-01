/**
 * User Routes
 * Handles user-related endpoints (get users, health checks)
 */

function createUserRoutes(app, pool, shardId) {
  
  /**
   * GET /health
   * Health check endpoint
   */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: `shard-${shardId}` });
  });

  /**
   * GET /api/users
   * Get all users in this shard
   */
  app.get('/api/users', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT COALESCE(from_user_id, to_user_id) as user_id 
         FROM messages 
         WHERE shard_id = $1`,
        [shardId]
      );

      const users = result.rows.map(row => row.user_id);
      console.log(`[SHARD-${shardId}] Retrieved ${users.length} users`);
      res.json({ users, shard_id: shardId });
    } catch (error) {
      console.error(`[SHARD-${shardId}] Error fetching users:`, error.message);
      res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
  });
}

module.exports = { createUserRoutes };
