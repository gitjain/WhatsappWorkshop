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
   * Get all users with their names
   */
  app.get('/api/users', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name 
         FROM users 
         ORDER BY id`
      );

      const users = result.rows.map(row => ({
        id: row.id,
        name: row.name
      }));
      console.log(`[SHARD-${shardId}] Retrieved ${users.length} users with names`);
      res.json({ users, shard_id: shardId });
    } catch (error) {
      console.error(`[SHARD-${shardId}] Error fetching users:`, error.message);
      res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
  });
}

module.exports = { createUserRoutes };
