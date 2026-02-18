/**
 * API Gateway - Routes requests to shards and publishes to message queue
 *
 * INTERVIEW NOTES:
 * ================
 * Q: What's the role of an API Gateway?
 * A: 1. Single entry point for all clients
 *    2. Request routing to appropriate microservices
 *    3. Authentication/Authorization (not implemented here)
 *    4. Rate limiting, caching, logging
 *    5. Protocol translation (REST to gRPC, etc.)
 *
 * Q: Why publish to a queue instead of direct DB write?
 * A: 1. FASTER RESPONSE: Gateway returns immediately, write happens async
 *    2. RELIABILITY: If DB is down, messages wait in queue
 *    3. SCALABILITY: Add more workers without changing gateway
 *    4. BACKPRESSURE: Queue absorbs traffic spikes
 *
 * Q: What's the trade-off of async writes?
 * A: Eventual consistency - message might take a moment to appear
 *    Solution: Return optimistic response, client shows message immediately
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const GATEWAY_ID = process.env.GATEWAY_ID || '1';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const QUEUE_NAME = 'messages';

// RabbitMQ connection
let rabbitChannel = null;

// Configuration with backup shards for failover
const SHARDS = [
  { id: 1, primary: 'http://shard-1:4001', backup: 'http://shard-1-backup:4001' },
  { id: 2, primary: 'http://shard-2:4002', backup: 'http://shard-2-backup:4002' },
  { id: 3, primary: 'http://shard-3:4003', backup: 'http://shard-3-backup:4003' }
];

// Track shard health
const shardHealth = new Map();
SHARDS.forEach(shard => {
  shardHealth.set(shard.id, { healthy: true, failedAttempts: 0, lastChecked: Date.now() });
});

app.use(cors());
app.use(express.json());

// Middleware to log requests with gateway ID
app.use((req, res, next) => {
  console.log(`[GATEWAY-${GATEWAY_ID}] ${req.method} ${req.path}`);
  next();
});

// Connect to RabbitMQ
async function connectRabbitMQ() {
  let connected = false;
  let attempts = 0;

  while (!connected && attempts < 30) {
    try {
      console.log(`[GATEWAY-${GATEWAY_ID}] Connecting to RabbitMQ...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();

      // Declare queue with same settings as worker (DLQ support)
      await rabbitChannel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': 'messages_dlq'
        }
      });

      console.log(`[GATEWAY-${GATEWAY_ID}] Connected to RabbitMQ, queue: ${QUEUE_NAME}`);
      connected = true;

      // Handle disconnection
      connection.on('close', () => {
        console.error(`[GATEWAY-${GATEWAY_ID}] RabbitMQ connection closed, reconnecting...`);
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });

    } catch (error) {
      attempts++;
      console.log(`[GATEWAY-${GATEWAY_ID}] RabbitMQ not ready, retrying in 2s... (${attempts}/30)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  if (!connected) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Failed to connect to RabbitMQ`);
  }
}

// Helper function to determine shard based on user_id
function getShardForUser(userId) {
  const shardId = (Math.abs(parseInt(userId)) % SHARDS.length) || SHARDS.length;
  const shard = SHARDS.find(s => s.id === shardId);
  return shard;
}

// Helper function to make request with failover
async function makeShardRequest(shard, method, endpoint, data = null) {
  const urls = [shard.primary, shard.backup];

  for (const url of urls) {
    try {
      let response;
      if (method === 'GET') {
        response = await axios.get(`${url}${endpoint}`, { timeout: 5000 });
      } else if (method === 'POST') {
        response = await axios.post(`${url}${endpoint}`, data, { timeout: 5000 });
      }

      shardHealth.set(shard.id, { healthy: true, failedAttempts: 0, lastChecked: Date.now() });
      return response.data;
    } catch (error) {
      console.warn(`[GATEWAY-${GATEWAY_ID}] Failed to reach ${url}: ${error.message}`);
    }
  }

  shardHealth.set(shard.id, { healthy: false, failedAttempts: (shardHealth.get(shard.id)?.failedAttempts || 0) + 1, lastChecked: Date.now() });
  throw new Error(`Both primary and backup shards failed for shard ${shard.id}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    gateway_id: GATEWAY_ID,
    rabbitmq: rabbitChannel ? 'connected' : 'disconnected',
    shards: Object.fromEntries(shardHealth)
  });
});

// Get shard info
app.get('/api/shards', (req, res) => {
  res.json({
    gateway_id: GATEWAY_ID,
    shards: SHARDS.map(s => ({
      id: s.id,
      primary: s.primary,
      backup: s.backup,
      health: shardHealth.get(s.id)
    }))
  });
});

/**
 * Send message - PUBLISHES TO RABBITMQ (async processing)
 *
 * INTERVIEW: This is the key architectural change!
 * Instead of: Client → Gateway → Shard (sync, slow)
 * We do:      Client → Gateway → Queue → Worker → Shard (async, fast response)
 */
app.post('/api/messages', async (req, res) => {
  try {
    const { from_user_id, to_user_id, content } = req.body;

    if (!from_user_id || !to_user_id || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate message ID and timestamp here for immediate response
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    // Check if RabbitMQ is connected
    if (!rabbitChannel) {
      // Fallback to direct shard write if queue is down
      console.warn(`[GATEWAY-${GATEWAY_ID}] RabbitMQ unavailable, falling back to direct write`);
      const shard = getShardForUser(from_user_id);
      const response = await makeShardRequest(shard, 'POST', '/api/messages', {
        from_user_id,
        to_user_id,
        content
      });
      return res.json(response);
    }

    // Publish to RabbitMQ
    const message = {
      id: messageId,
      from_user_id,
      to_user_id,
      content,
      created_at: timestamp,
      gateway_id: GATEWAY_ID
    };

    rabbitChannel.sendToQueue(
      QUEUE_NAME,
      Buffer.from(JSON.stringify(message)),
      { persistent: true }  // Message survives broker restart
    );

    console.log(`[GATEWAY-${GATEWAY_ID}] Message queued: ${messageId}`);

    // INTERVIEW: Return optimistic response immediately
    // Client shows message right away, actual write happens async
    res.json({
      id: messageId,
      from_user_id,
      to_user_id,
      content,
      created_at: timestamp,
      status: 'queued',
      gateway_id: GATEWAY_ID
    });

  } catch (error) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Error sending message:`, error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get messages for a user - DIRECT READ (sync, needs immediate data)
app.get('/api/messages/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const shard = getShardForUser(userId);

    const response = await makeShardRequest(shard, 'GET', `/api/messages/${userId}`);
    res.json({ ...response, gateway_id: GATEWAY_ID });
  } catch (error) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Error fetching messages:`, error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get conversation between two users - query BOTH shards and merge
app.get('/api/conversations/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const userShard = getShardForUser(userId);
    const otherShard = getShardForUser(otherUserId);

    // Fetch from both shards with failover
    const resp1 = await makeShardRequest(userShard, 'GET', `/api/conversations/${userId}/${otherUserId}`);

    let resp2Data = { messages: [] };
    if (otherShard.id !== userShard.id) {
      const resp2 = await makeShardRequest(otherShard, 'GET', `/api/conversations/${userId}/${otherUserId}`);
      resp2Data = resp2;
    }

    // Merge messages from both shards and sort by timestamp
    const allMessages = [...(resp1.messages || []), ...(resp2Data.messages || [])];
    allMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Remove duplicates
    const uniqueMessages = [];
    const seen = new Set();
    allMessages.forEach(msg => {
      const key = `${msg.from_user_id}-${msg.to_user_id}-${msg.created_at}`;
      if (!seen.has(key)) {
        uniqueMessages.push(msg);
        seen.add(key);
      }
    });

    res.json({
      messages: uniqueMessages,
      user_id: userId,
      other_user_id: otherUserId,
      shards_queried: userShard.id !== otherShard.id ? [userShard.id, otherShard.id] : [userShard.id],
      gateway_id: GATEWAY_ID
    });
  } catch (error) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Error fetching conversation:`, error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const promises = SHARDS.map(shard =>
      makeShardRequest(shard, 'GET', '/api/users')
        .then(data => data.users || [])
        .catch(err => {
          console.warn(`[GATEWAY-${GATEWAY_ID}] Failed to get users from shard ${shard.id}:`, err.message);
          return [];
        })
    );

    const allUsers = await Promise.all(promises);
    const users = allUsers.flat();

    res.json({ users, total: users.length, gateway_id: GATEWAY_ID });
  } catch (error) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Error fetching users:`, error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Health check for all shards
app.get('/api/health/shards', async (req, res) => {
  try {
    const healthChecks = SHARDS.map(shard => ({
      shard: shard.id,
      primary: shard.primary,
      backup: shard.backup,
      health: shardHealth.get(shard.id)
    }));

    res.json({ shards: healthChecks, gateway_id: GATEWAY_ID });
  } catch (error) {
    console.error(`[GATEWAY-${GATEWAY_ID}] Error checking shard health:`, error.message);
    res.status(500).json({ error: 'Failed to check shard health', details: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    API GATEWAY ${GATEWAY_ID}                           ║
╠════════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                    ║
║  Shards: ${SHARDS.map(s => s.id).join(', ')}                                               ║
║  Queue: ${QUEUE_NAME}                                              ║
╚════════════════════════════════════════════════════════════════╝
  `);

  // Connect to RabbitMQ
  await connectRabbitMQ();
});
