const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Configuration
const SHARDS = [
  { id: 1, url: 'http://shard-1:4001' },
  { id: 2, url: 'http://shard-2:4002' },
  { id: 3, url: 'http://shard-3:4003' }
];

app.use(cors());
app.use(express.json());

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`[GATEWAY] ${req.method} ${req.path}`);
  next();
});

// Helper function to determine shard based on user_id
// User 1, 4, 7, 10... -> Shard 1
// User 2, 5, 8, 11... -> Shard 2
// User 3, 6, 9, 12... -> Shard 3
function getShardForUser(userId) {
  const shardId = (Math.abs(parseInt(userId)) % SHARDS.length) || SHARDS.length;
  const shard = SHARDS.find(s => s.id === shardId);
  console.log(`[GATEWAY] User ${userId} maps to Shard ${shardId}`);
  return shard;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway' });
});

// Get shard info
app.get('/api/shards', (req, res) => {
  res.json({ shards: SHARDS });
});

// Send message - routes to appropriate shard
app.post('/api/messages', async (req, res) => {
  try {
    const { from_user_id, to_user_id, content } = req.body;
    
    if (!from_user_id || !to_user_id || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Route based on sender's shard
    const shard = getShardForUser(from_user_id);
    console.log(`[GATEWAY] Routing message from user ${from_user_id} to shard ${shard.id}`);

    const response = await axios.post(`${shard.url}/api/messages`, {
      from_user_id,
      to_user_id,
      content
    });

    res.json(response.data);
  } catch (error) {
    console.error('[GATEWAY] Error sending message:', error.message);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Get messages for a user - routes to appropriate shard
app.get('/api/messages/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const shard = getShardForUser(userId);
    
    console.log(`[GATEWAY] Fetching messages for user ${userId} from shard ${shard.id}`);

    const response = await axios.get(`${shard.url}/api/messages/${userId}`);
    res.json(response.data);
  } catch (error) {
    console.error('[GATEWAY] Error fetching messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

// Get conversation between two users - query BOTH shards and merge
app.get('/api/conversations/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const userShard = getShardForUser(userId);
    const otherShard = getShardForUser(otherUserId);
    
    console.log(`[GATEWAY] Fetching conversation between ${userId} (Shard ${userShard.id}) and ${otherUserId} (Shard ${otherShard.id})`);

    // Fetch from both shards in parallel
    const [resp1, resp2] = await Promise.all([
      axios.get(`${userShard.url}/api/conversations/${userId}/${otherUserId}`).catch(err => ({ data: { messages: [] } })),
      otherShard.id !== userShard.id 
        ? axios.get(`${otherShard.url}/api/conversations/${userId}/${otherUserId}`).catch(err => ({ data: { messages: [] } }))
        : Promise.resolve({ data: { messages: [] } })
    ]);

    // Merge messages from both shards and sort by timestamp
    const allMessages = [...(resp1.data.messages || []), ...(resp2.data.messages || [])];
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
    res.status(500).json({ error: 'Failed to fetch conversation', details: error.message });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    console.log('[GATEWAY] Fetching all users from all shards');
    
    const promises = SHARDS.map(shard =>
      axios.get(`${shard.url}/api/users`)
        .then(resp => resp.data.users || [])
        .catch(err => {
          console.error(`Error fetching from shard ${shard.id}:`, err.message);
          return [];
        })
    );

    const allUsers = await Promise.all(promises);
    const users = allUsers.flat();

    res.json({ users, total: users.length });
  } catch (error) {
    console.error('[GATEWAY] Error fetching users:', error.message);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// Health check for all shards
app.get('/api/health/shards', async (req, res) => {
  try {
    const healthChecks = await Promise.all(
      SHARDS.map(shard =>
        axios.get(`${shard.url}/health`)
          .then(() => ({ shard: shard.id, status: 'healthy' }))
          .catch(() => ({ shard: shard.id, status: 'unhealthy' }))
      )
    );

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
