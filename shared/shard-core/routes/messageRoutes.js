/**
 * Message Routes
 * Handles all message-related endpoints (send, retrieve, get conversations)
 */

const { v4: uuidv4 } = require('uuid');

function createMessageRoutes(app, pool, redisClient, shardId, connectedClients) {
  
  /**
   * POST /api/messages
   * Send a new message
   */
  app.post('/api/messages', async (req, res) => {
    try {
      const { from_user_id, to_user_id, content } = req.body;
      const messageId = uuidv4();
      const timestamp = new Date();

      // Save to PostgreSQL
      await pool.query(
        `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, from_user_id, to_user_id, content, timestamp, shardId]
      );

      // Cache in Redis
      const cacheKey = `msg:${from_user_id}:${to_user_id}`;
      await redisClient.lPush(cacheKey, JSON.stringify({
        id: messageId,
        from_user_id,
        to_user_id,
        content,
        created_at: timestamp
      }));
      await redisClient.expire(cacheKey, 3600); // 1 hour TTL

      console.log(`[SHARD-${shardId}] Message created: ${messageId}`);

      // Notify recipient if connected via WebSocket
      if (connectedClients.has(to_user_id)) {
        const ws = connectedClients.get(to_user_id);
        ws.send(JSON.stringify({
          type: 'message',
          messageId,
          from_user_id,
          to_user_id,
          content,
          created_at: timestamp
        }));
      }

      res.json({
        id: messageId,
        from_user_id,
        to_user_id,
        content,
        created_at: timestamp,
        shard_id: shardId
      });
    } catch (error) {
      console.error(`[SHARD-${shardId}] Error creating message:`, error.message);
      res.status(500).json({ error: 'Failed to create message', details: error.message });
    }
  });

  /**
   * GET /api/messages/:userId
   * Get all messages for a specific user
   */
  app.get('/api/messages/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = req.query.limit || 50;

      const cacheKey = `user:messages:${userId}`;
      let messages = await redisClient.get(cacheKey);

      if (!messages) {
        const result = await pool.query(
          `SELECT * FROM messages 
           WHERE from_user_id = $1 OR to_user_id = $1 
           ORDER BY created_at DESC 
           LIMIT $2`,
          [userId, limit]
        );
        
        messages = result.rows;
        
        // Cache the result
        await redisClient.setEx(cacheKey, 300, JSON.stringify(messages)); // 5 min TTL
      } else {
        messages = JSON.parse(messages);
      }

      console.log(`[SHARD-${shardId}] Retrieved ${messages.length} messages for user ${userId}`);
      res.json({ messages, user_id: userId, shard_id: shardId });
    } catch (error) {
      console.error(`[SHARD-${shardId}] Error fetching messages:`, error.message);
      res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
    }
  });

  /**
   * GET /api/conversations/:userId/:otherUserId
   * Get conversation between two specific users
   */
  app.get('/api/conversations/:userId/:otherUserId', async (req, res) => {
    try {
      const { userId, otherUserId } = req.params;
      const limit = req.query.limit || 100;

      const cacheKey = `conv:${userId}:${otherUserId}`;
      let messages = await redisClient.get(cacheKey);

      if (!messages) {
        const result = await pool.query(
          `SELECT * FROM messages 
           WHERE (from_user_id = $1 AND to_user_id = $2) 
              OR (from_user_id = $2 AND to_user_id = $1)
           ORDER BY created_at ASC 
           LIMIT $3`,
          [userId, otherUserId, limit]
        );
        
        messages = result.rows;
        
        // Cache the result
        await redisClient.setEx(cacheKey, 300, JSON.stringify(messages)); // 5 min TTL
      } else {
        messages = JSON.parse(messages);
      }

      console.log(`[SHARD-${shardId}] Retrieved conversation between ${userId} and ${otherUserId}: ${messages.length} messages`);
      res.json({ 
        messages, 
        user_id: userId, 
        other_user_id: otherUserId,
        shard_id: shardId 
      });
    } catch (error) {
      console.error(`[SHARD-${shardId}] Error fetching conversation:`, error.message);
      res.status(500).json({ error: 'Failed to fetch conversation', details: error.message });
    }
  });
}

module.exports = { createMessageRoutes };
