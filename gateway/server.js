const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

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

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`[GATEWAY] ${req.method} ${req.path}`);
  next();
});

// Helper function to determine shard based on user_id
function getShardForUser(userId) {
  const shardId = (Math.abs(parseInt(userId)) % SHARDS.length) || SHARDS.length;
  const shard = SHARDS.find(s => s.id === shardId);
  console.log(`[GATEWAY] User ${userId} maps to Shard ${shardId}`);
  return shard;
}

// Helper function to make request with failover
async function makeShardRequest(shard, method, endpoint, data = null) {
  const urls = [shard.primary, shard.backup];
  
  for (const url of urls) {
    try {
      console.log(`[GATEWAY] Attempting request to ${url}${endpoint}`);
      
      let response;
      if (method === 'GET') {
        response = await axios.get(`${url}${endpoint}`, { timeout: 5000 });
      } else if (method === 'POST') {
        response = await axios.post(`${url}${endpoint}`, data, { timeout: 5000 });
      }
      
      // Mark as healthy if successful
      shardHealth.set(shard.id, { healthy: true, failedAttempts: 0, lastChecked: Date.now() });
      console.log(`[GATEWAY] Request successful on shard ${shard.id}`);
      
      return response.data;
    } catch (error) {
      console.warn(`[GATEWAY] Failed to reach ${url}: ${error.message}`);
    }
  }
  
  // All attempts failed
  shardHealth.set(shard.id, { healthy: false, failedAttempts: (shardHealth.get(shard.id)?.failedAttempts || 0) + 1, lastChecked: Date.now() });
  throw new Error(`Both primary and backup shards failed for shard ${shard.id}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', shards: Object.fromEntries(shardHealth) });
});

// Get shard info
app.get('/api/shards', (req, res) => {
  res.json({ 
    shards: SHARDS.map(s => ({
      id: s.id,
      primary: s.primary,
      backup: s.backup,
      health: shardHealth.get(s.id)
    }))
  });
});

// Send message - routes to appropriate shard with failover
app.post('/api/messages', async (req, res) => {
  try {
    const { from_user_id, to_user_id, content } = req.body;
    
    if (!from_user_id || !to_user_id || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const shard = getShardForUser(from_user_id);
    console.log(`[GATEWAY] Routing message from user ${from_user_id} to shard ${shard.id}`);

    const response = await makeShardRequest(shard, 'POST', '/api/messages', {
      from_user_id,
      to_user_id,
      content
    });

    res.json(response);
  } catch (error) {
    console.error('[GATEWAY] Error sending message:', error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get messages for a user - routes to appropriate shard with failover
app.get('/api/messages/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const shard = getShardForUser(userId);
    
    console.log(`[GATEWAY] Fetching messages for user ${userId} from shard ${shard.id}`);

    const response = await makeShardRequest(shard, 'GET', `/api/messages/${userId}`);
    res.json(response);
  } catch (error) {
    console.error('[GATEWAY] Error fetching messages:', error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get conversation between two users - query BOTH shards and merge
app.get('/api/conversations/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const userShard = getShardForUser(userId);
    const otherShard = getShardForUser(otherUserId);
    
    console.log(`[GATEWAY] Fetching conversation between ${userId} (Shard ${userShard.id}) and ${otherUserId} (Shard ${otherShard.id})`);

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
      shards_queried: userShard.id !== otherShard.id ? [userShard.id, otherShard.id] : [userShard.id]
    });
  } catch (error) {
    console.error('[GATEWAY] Error fetching conversation:', error.message);
    res.status(503).json({ error: 'Service unavailable', details: error.message });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    console.log('[GATEWAY] Fetching all users from all shards');
    
    const promises = SHARDS.map(shard =>
      makeShardRequest(shard, 'GET', '/api/users')
        .then(data => data.users || [])
        .catch(err => {
          console.warn(`[GATEWAY] Failed to get users from shard ${shard.id}:`, err.message);
          return [];
        })
    );

    const allUsers = await Promise.all(promises);
    const users = allUsers.flat();

    res.json({ users, total: users.length });
  } catch (error) {
    console.error('[GATEWAY] Error fetching users:', error.message);
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

    res.json({ shards: healthChecks });
  } catch (error) {
    console.error('[GATEWAY] Error checking shard health:', error.message);
    res.status(500).json({ error: 'Failed to check shard health', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[GATEWAY] Server listening on port ${PORT}`);
  console.log(`[GATEWAY] Shards: ${SHARDS.map(s => s.id).join(', ')}`);
});
