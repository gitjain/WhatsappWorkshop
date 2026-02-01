/**
 * Shard Server Core - Main Entry Point
 * Orchestrates all shard server components (database, routes, WebSocket)
 * Clean, organized code with separated concerns (but in single file for Docker)
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');
const pg = require('pg');
const { v4: uuidv4 } = require('uuid');
const { ReplicationManager } = require('./replication');

/**
 * Main function to create and initialize a shard server
 * @param {Object} shardConfig - Configuration object with SHARD_ID, PORT, DB credentials, etc.
 * @returns {Object} HTTP server instance
 */
async function createShardServer(shardConfig) {
  const {
    SHARD_ID = '1',
    PORT = 4001,
    REDIS_URL = 'redis://redis:6379',
    DB_HOST = 'postgres',
    DB_PORT = 5432,
    DB_NAME = 'whatsapp',
    DB_USER = 'postgres',
    DB_PASSWORD = 'postgres',
    DB_BACKUP_HOST = 'postgres-backup',
    DB_BACKUP_PORT = 5432
  } = shardConfig;

  console.log(`[SHARD-${SHARD_ID}] Initializing shard server...`);

  // ==================== SETUP EXPRESS & HTTP ====================
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws' });

  // ==================== SETUP DATABASE CONNECTIONS ====================
  const redisClient = redis.createClient({ url: REDIS_URL });
  await redisClient.connect();
  console.log(`[SHARD-${SHARD_ID}] Connected to Redis`);

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

  // ==================== SETUP DATABASE REPLICATION ====================
  const replicationManager = new ReplicationManager(
    SHARD_ID,
    { host: DB_HOST, port: DB_PORT, database: DB_NAME, user: DB_USER, password: DB_PASSWORD },
    { host: DB_BACKUP_HOST, port: DB_BACKUP_PORT, database: DB_NAME, user: DB_USER, password: DB_PASSWORD }
  );
  
  replicationManager.initialize();
  console.log(`[SHARD-${SHARD_ID}] Replication manager initialized`);

  // ==================== SETUP MIDDLEWARE ====================
  app.use(cors());
  app.use(express.json());

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[SHARD-${SHARD_ID}] ${req.method} ${req.path}`);
    next();
  });

  // ==================== WEBSOCKET CONNECTION TRACKING ====================
  const connectedClients = new Map();

  // ==================== USER ROUTES ====================

  /**
   * GET /health
   * Health check endpoint
   */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: `shard-${SHARD_ID}` });
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
        [SHARD_ID]
      );

      const users = result.rows.map(row => row.user_id);
      console.log(`[SHARD-${SHARD_ID}] Retrieved ${users.length} users`);
      res.json({ users, shard_id: SHARD_ID });
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error fetching users:`, error.message);
      res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
  });

  // ==================== MESSAGE ROUTES ====================

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
        [messageId, from_user_id, to_user_id, content, timestamp, SHARD_ID]
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

      console.log(`[SHARD-${SHARD_ID}] Message created: ${messageId}`);

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
        shard_id: SHARD_ID
      });
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error creating message:`, error.message);
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

      console.log(`[SHARD-${SHARD_ID}] Retrieved ${messages.length} messages for user ${userId}`);
      res.json({ messages, user_id: userId, shard_id: SHARD_ID });
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error fetching messages:`, error.message);
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

      console.log(`[SHARD-${SHARD_ID}] Retrieved conversation between ${userId} and ${otherUserId}: ${messages.length} messages`);
      res.json({ 
        messages, 
        user_id: userId, 
        other_user_id: otherUserId,
        shard_id: SHARD_ID 
      });
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error fetching conversation:`, error.message);
      res.status(500).json({ error: 'Failed to fetch conversation', details: error.message });
    }
  });

  // ==================== WEBSOCKET HANDLERS ====================

  wss.on('connection', (ws, req) => {
    console.log(`[SHARD-${SHARD_ID}] New WebSocket connection`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`[SHARD-${SHARD_ID}] Received WebSocket message:`, message.type);

        // User registration on WebSocket
        if (message.type === 'register') {
          const userId = message.user_id;
          connectedClients.set(userId, ws);
          console.log(`[SHARD-${SHARD_ID}] User ${userId} registered on WebSocket`);
          
          ws.send(JSON.stringify({
            type: 'registered',
            user_id: userId,
            shard_id: SHARD_ID
          }));
        }
        // Send message via WebSocket
        else if (message.type === 'send_message') {
          const { from_user_id, to_user_id, content } = message;
          const messageId = uuidv4();
          const timestamp = new Date();

          try {
            // Save to database
            await pool.query(
              `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) 
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [messageId, from_user_id, to_user_id, content, timestamp, SHARD_ID]
            );

            // Invalidate conversation cache
            await redisClient.del(`conv:${from_user_id}:${to_user_id}`);
            await redisClient.del(`conv:${to_user_id}:${from_user_id}`);

            const msgData = {
              type: 'message',
              id: messageId,
              from_user_id,
              to_user_id,
              content,
              created_at: timestamp
            };

            // Send to recipient if connected
            if (connectedClients.has(to_user_id)) {
              const recipientWs = connectedClients.get(to_user_id);
              recipientWs.send(JSON.stringify(msgData));
            }

            // Send confirmation to sender
            ws.send(JSON.stringify({
              type: 'message_sent',
              id: messageId,
              status: 'delivered'
            }));

            console.log(`[SHARD-${SHARD_ID}] WebSocket message from ${from_user_id} to ${to_user_id}`);
          } catch (error) {
            console.error(`[SHARD-${SHARD_ID}] Error handling WebSocket message:`, error.message);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to send message'
            }));
          }
        }
      } catch (error) {
        console.error(`[SHARD-${SHARD_ID}] WebSocket parse error:`, error.message);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });

    ws.on('close', () => {
      // Handle client disconnection
      for (const [userId, clientWs] of connectedClients.entries()) {
        if (clientWs === ws) {
          connectedClients.delete(userId);
          console.log(`[SHARD-${SHARD_ID}] User ${userId} disconnected from WebSocket`);
          break;
        }
      }
    });

    ws.on('error', (error) => {
      console.error(`[SHARD-${SHARD_ID}] WebSocket connection error:`, error.message);
    });
  });

  // ==================== GRACEFUL SHUTDOWN ====================

  process.on('SIGTERM', async () => {
    console.log(`[SHARD-${SHARD_ID}] SIGTERM received, shutting down gracefully...`);
    
    try {
      await redisClient.quit();
      console.log(`[SHARD-${SHARD_ID}] Redis connection closed`);
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error closing Redis:`, error.message);
    }

    try {
      await pool.end();
      console.log(`[SHARD-${SHARD_ID}] PostgreSQL connection closed`);
    } catch (error) {
      console.error(`[SHARD-${SHARD_ID}] Error closing PostgreSQL:`, error.message);
    }
    
    server.close(() => {
      console.log(`[SHARD-${SHARD_ID}] Server closed`);
      process.exit(0);
    });
  });

  // ==================== START SERVER ====================

  server.listen(PORT, () => {
    console.log(`[SHARD-${SHARD_ID}] Server listening on port ${PORT}`);
    console.log(`[SHARD-${SHARD_ID}] WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
  });

  return server;
}

module.exports = { createShardServer };
