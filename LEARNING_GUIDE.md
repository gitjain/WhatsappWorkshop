# WhatsApp Clone - File Guide & Learning Path

## 📚 Learning Path (Recommended Order)

### **Phase 1: Architecture & Infrastructure (Foundations)**
1. `docker-compose.yml` - System setup
2. `.env` - Configuration
3. `README.md` - Project overview

### **Phase 2: Data Layer (Database & Cache)**
4. `postgres/init.sql` - Database schema
5. Redis (conceptual understanding)

### **Phase 3: Server Architecture**
6. `gateway/server.js` - Request routing
7. `shard-1/server.js` - Message shard (core logic)
8. `shard-2/server.js` & `shard-3/server.js` - Replicated shards

### **Phase 4: Client & UI**
9. `client/index.html` - Web interface

---

## 📁 Detailed File Breakdown

### **PHASE 1: INFRASTRUCTURE**

---

## 1. 📄 `docker-compose.yml` (START HERE!)
**What it does:** Orchestrates all 7 services

**Key concepts:**
- Defines all services (postgres, redis, 3 shards, gateway, client)
- Sets up networking between services
- Creates persistent volumes for data
- Sets environment variables
- Health checks and dependencies

**What to learn:**
- How services communicate (service names as hostnames)
- Port mappings (host:container)
- Environment variable passing
- Service dependencies (postgres starts before shards)

**Example lines:**
```yaml
services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"  # Host:Container
```

---

## 2. 📋 `.env` (Configuration File)
**What it does:** Centralized configuration

**Key variables:**
```
POSTGRES_DB=whatsapp        # Database name
POSTGRES_USER=postgres      # DB user
POSTGRES_PASSWORD=postgres  # DB password
REDIS_URL=redis://redis:6379  # Cache server
GATEWAY_PORT=3000           # API Gateway port
SHARD_*_PORT=400X           # Individual shard ports
```

**Why it matters:**
- Single place to change all settings
- Don't hardcode passwords in code
- Easy to swap between dev/prod configs

---

## 3. 📖 `README.md` (Project Documentation)
**What it does:** Complete documentation

**Contains:**
- Architecture diagram
- Quick start instructions
- API endpoint documentation
- Sharding logic explanation
- Troubleshooting guide

**Read this when:** You need context or have questions

---

### **PHASE 2: DATA LAYER**

---

## 4. 🗄️ `postgres/init.sql` (Database Schema)
**What it does:** Creates database structure on startup

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,           -- Unique message ID
  from_user_id VARCHAR(50),      -- Sender
  to_user_id VARCHAR(50),        -- Recipient
  content TEXT,                  -- Message text
  created_at TIMESTAMP,          -- When sent
  shard_id VARCHAR(10)           -- Which shard stores this
);
```

**Key indexes:**
```sql
-- Fast lookups by sender
CREATE INDEX idx_messages_from_user ON messages(from_user_id);

-- Fast lookups by recipient
CREATE INDEX idx_messages_to_user ON messages(to_user_id);

-- Fast conversation retrieval (sender + recipient)
CREATE INDEX idx_messages_conversation 
  ON messages(from_user_id, to_user_id);
```

**Why indexes matter:**
- Without indexes: Database scans every row (SLOW)
- With indexes: Direct lookup (FAST)
- Example: Find all messages from user 1 to user 2 → uses conversation index

---

## 5. 🔴 Redis (Caching Layer)
**What it does:** In-memory cache for fast data access

**How it's used in shards:**
```javascript
// Check cache first (fast)
let messages = await redisClient.get(`conv:${userId}:${otherId}`);

if (!messages) {
  // Cache miss - query database (slow)
  const result = await pool.query(...);
  messages = result.rows;
  
  // Store in cache for next time (5 min TTL)
  await redisClient.setEx(cacheKey, 300, JSON.stringify(messages));
}
```

**Benefits:**
- Faster response times
- Less database load
- Better scalability

---

### **PHASE 3: SERVER ARCHITECTURE**

---

## 6. 🚪 `gateway/server.js` (Request Router)
**What it does:** Single entry point for all requests

### Key Concept: Sharding Logic
```javascript
// Messages are distributed by user_id
function getShardForUser(userId) {
  const shardIndex = Math.abs(parseInt(userId)) % SHARDS.length;
  return SHARDS[shardIndex];  // Returns shard 1, 2, or 3
}
```

**Example:**
- User 1 → 1 % 3 = 1 → Shard 1 (port 4001)
- User 2 → 2 % 3 = 2 → Shard 2 (port 4002)
- User 3 → 3 % 3 = 0 → Shard 3 (port 4003)
- User 4 → 4 % 3 = 1 → Shard 1 (port 4001)

### Main Endpoints:
```javascript
// 1. Send a message
POST /api/messages
  → Routes to shard based on from_user_id
  → Shard stores in DB + Redis
  → Returns message with shard_id

// 2. Get conversation
GET /api/conversations/1/2
  → Routes to user 1's shard
  → Fetches messages between 1 and 2

// 3. Get all users
GET /api/users
  → Queries ALL shards in parallel
  → Combines results

// 4. Health check
GET /api/health/shards
  → Checks if all 3 shards are alive
```

### Flow Diagram:
```
Client Request
       ↓
   Gateway (Port 3000)
       ↓
  Determine Shard (user_id % 3)
       ↓
   Route to Shard (Port 400X)
       ↓
  Shard (Express + WebSocket)
```

---

## 7. 🧠 `shard-1/server.js` (Message Server - CORE LOGIC)
**What it does:** Handles messages for a subset of users

### Three Main Responsibilities:

#### A) REST API Endpoints
```javascript
// Receive message from gateway
POST /api/messages {from_user_id, to_user_id, content}
  1. Save to PostgreSQL (persistent)
  2. Cache in Redis (fast retrieval)
  3. Notify recipient if connected via WebSocket

GET /api/messages/:userId
  1. Check Redis cache first
  2. If miss: Query PostgreSQL
  3. Cache the result

GET /api/conversations/:userId/:otherId
  1. Check Redis cache
  2. If miss: Query PostgreSQL with WHERE clause
  3. Return conversation in chronological order
```

#### B) WebSocket Real-Time Messaging
```javascript
// Client connects to WebSocket
ws://shard-1:4001/ws

// Client registers their user_id
{type: "register", user_id: "1"}

// Shard stores client connection
connectedClients.set("1", websocketConnection)

// New message arrives → notify recipient instantly
if (connectedClients.has(to_user_id)) {
  recipientWs.send(messageData);  // Real-time delivery
}
```

#### C) Database Operations
```javascript
// Create message
INSERT INTO messages (id, from_user_id, to_user_id, content, ...)
VALUES ($1, $2, $3, $4, ...)

// Query conversation
SELECT * FROM messages 
WHERE (from_user_id = $1 AND to_user_id = $2)
   OR (from_user_id = $2 AND to_user_id = $1)
ORDER BY created_at ASC
```

### Code Flow - Sending a Message:
```javascript
app.post('/api/messages', async (req, res) => {
  // 1. Extract data from request
  const {from_user_id, to_user_id, content} = req.body;
  
  // 2. Generate unique ID
  const messageId = uuidv4();
  
  // 3. Save to database (PERSISTENT)
  await pool.query(
    'INSERT INTO messages (...) VALUES (...)',
    [messageId, from_user_id, to_user_id, content, timestamp, SHARD_ID]
  );
  
  // 4. Cache in Redis (FAST)
  await redisClient.lPush(`msg:${from_user_id}:${to_user_id}`, 
    JSON.stringify({...}));
  
  // 5. Send real-time notification if recipient is online
  if (connectedClients.has(to_user_id)) {
    const ws = connectedClients.get(to_user_id);
    ws.send(JSON.stringify({type: 'message', ...}));
  }
  
  // 6. Return success response
  res.json({id: messageId, status: 'delivered', shard_id: SHARD_ID});
});
```

### Key Data Structures:
```javascript
// Connected clients map (in-memory)
connectedClients = Map {
  "1" -> WebSocketConnection,
  "5" -> WebSocketConnection,
  ...
}

// Redis cache key format
"conv:1:2"        // Conversation between user 1 and 2
"msg:1:2"         // Message stream from 1 to 2
"user:messages:1" // All messages for user 1
```

---

## 8. 📦 `shard-2/server.js` & `shard-3/server.js` (Replica Shards)
**What they do:** Same as Shard 1, handle different user ranges

**Why 3 shards?**
- Distribute load
- Users 1,4,7,10... → Shard 1
- Users 2,5,8,11... → Shard 2
- Users 3,6,9,12... → Shard 3

**Identical code:** All shards run the same server.js logic

---

### **PHASE 4: CLIENT LAYER**

---

## 9. 🌐 `client/index.html` (Web UI)
**What it does:** Frontend for messaging

### Three Main Sections:

#### A) User Registration
```javascript
async function registerUser() {
  currentUserId = document.getElementById('userId').value;
  await loadUsers();    // Fetch all users
  await loadMessages(); // Load message history
  updateStatus(true, 'Connected');
}
```

**What it does:**
1. Gets user ID from input box
2. Stores in `currentUserId` variable
3. Updates UI status indicator
4. Loads list of available users

#### B) Sending Messages
```javascript
async function sendMessage() {
  // 1. Get recipient and content
  const recipientId = document.getElementById('recipientId').value;
  const content = document.getElementById('messageContent').value;
  
  // 2. Send to gateway
  fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    body: JSON.stringify({
      from_user_id: currentUserId,
      to_user_id: recipientId,
      content: content
    })
  });
  
  // 3. Show success message with shard info
  showMessage('✓ Sent (Shard 2)');
  
  // 4. Reload conversation
  loadConversation();
}
```

**Flow:**
```
User types message
        ↓
Clicks "Send Message"
        ↓
HTTP POST to Gateway (localhost:3000/api/messages)
        ↓
Gateway routes to correct Shard
        ↓
Shard stores in DB + Redis + notifies recipient
        ↓
Response returns with shard_id
        ↓
UI displays "Message sent (Shard 2)"
```

#### C) Loading Conversations
```javascript
async function loadConversation() {
  // Get conversation from gateway
  const response = await fetch(
    'http://localhost:3000/api/conversations/1/2'
  );
  const messages = response.data.messages;
  
  // Display each message
  messages.forEach(msg => {
    if (msg.from_user_id === currentUserId) {
      // My message - right side, purple
      displayMessage(msg, 'sent');
    } else {
      // Their message - left side, white
      displayMessage(msg, 'received');
    }
  });
}
```

### UI Components:
```html
Left Panel:
├─ User Setup
│  └─ Register with user ID
├─ Online Users
│  └─ Click to select conversation
└─ System Health
   └─ Check shard status

Main Panel:
├─ Message History
│  └─ Shows conversation
└─ Send Message
   ├─ Recipient ID input
   ├─ Message text area
   └─ Send button
```

---

## 🔄 Complete Message Flow (End-to-End)

### Scenario: User 1 sends message to User 2

```
1. USER 1 IN BROWSER
   ├─ Enters: User ID = "1"
   ├─ Clicks: Register & Connect
   └─ currentUserId = "1" ✓

2. USER 1 LOADS USERS
   ├─ GET http://localhost:3000/api/users
   ├─ Gateway queries all 3 shards
   └─ Shows: [User 2, User 3, User 4, User 5, User 6]

3. USER 1 SELECTS USER 2
   ├─ Clicks on "User 2"
   ├─ selectedUserId = "2"
   ├─ GET /api/conversations/1/2
   └─ Shows empty (first time)

4. USER 1 SENDS MESSAGE
   ├─ Types: "Hello!"
   ├─ From: 1, To: 2, Content: "Hello!"
   └─ POST /api/messages

5. GATEWAY ROUTES
   ├─ Calculates: 1 % 3 = 1 → Shard 1
   ├─ Routes to: http://shard-1:4001/api/messages
   └─ Sends: {from_user_id: "1", to_user_id: "2", content: "Hello!"}

6. SHARD 1 PROCESSES
   ├─ Generates UUID: abc-123-xyz
   ├─ INSERT into PostgreSQL ✓
   ├─ Cache in Redis ✓
   ├─ Check: Is user 2 connected via WebSocket?
   │  └─ NO (not on this shard)
   └─ Returns: {id: "abc-123-xyz", shard_id: 1}

7. GATEWAY RETURNS RESPONSE
   └─ Sends to browser: {id: "abc-123-xyz", shard_id: 1, status: "success"}

8. USER 1 SEES
   ├─ "✓ Message sent (Shard 1)"
   ├─ Message appears on right (sent)
   ├─ "Hello!" shows with timestamp
   └─ Message content cleared for next message

9. USER 2 IN BROWSER
   ├─ Enters: User ID = "2"
   ├─ Clicks: Register & Connect
   ├─ Clicks on: "User 1"
   ├─ GET /api/conversations/1/2
   ├─ Gateway routes: 1 % 3 = 1 → Shard 1
   ├─ Shard 1 returns cached messages
   └─ Message appears on left (received): "Hello!"

10. USER 2 REPLIES
    ├─ Types: "Hi there!"
    ├─ From: 2, To: 1, Content: "Hi there!"
    ├─ POST /api/messages
    └─ Gateway routes: 2 % 3 = 2 → Shard 2

11. SHARD 2 PROCESSES
    ├─ INSERT into PostgreSQL ✓
    ├─ Cache in Redis ✓
    ├─ Check: Is user 1 connected?
    │  └─ NO (not on this shard)
    └─ Returns success

12. USER 1 REFRESHES / RELOADS
    ├─ GET /api/conversations/1/2
    ├─ Shard 1 gets fresh data from PostgreSQL
    └─ "Hi there!" appears on left
```

---

## 📊 Data Flow Diagram

```
┌─────────────────────┐
│   Browser (Client)  │
│  (index.html)       │
└──────────┬──────────┘
           │
           ├─ POST /api/messages
           ├─ GET /api/conversations/1/2
           └─ GET /api/users
           │
           ▼
┌─────────────────────┐
│  Gateway (3000)     │
│  (gateway/server.js)│
└────────┬────────┬───┘
         │        │
         │    ┌───┴──────────┐
         │    │ Shard Logic  │
         │    │ user_id % 3  │
         │    └───┬──────────┘
         │        │
    ┌────▼────┬───▼────┬───┬──────┐
    │          │        │   │      │
    ▼          ▼        ▼   ▼      ▼
  Shard 1   Shard 2  Shard 3  DB  Cache
  (4001)    (4002)   (4003)   PG  Redis
```

---

## 🎯 Quick Reference: Which File Does What?

| File | Purpose | Key Tech | Learn for |
|------|---------|----------|-----------|
| docker-compose.yml | Service orchestration | Docker | How services connect |
| .env | Configuration | Environment vars | Settings & secrets |
| gateway/server.js | Request routing | Express + Sharding | Request distribution |
| shard-1/server.js | Message handling | Node.js + WebSocket + PostgreSQL + Redis | Core business logic |
| client/index.html | Web interface | HTML/CSS/JavaScript | User interaction |
| postgres/init.sql | Database schema | SQL + Indexes | Data persistence |

---

## 📚 Concepts to Understand

### 1. **Sharding**
- Division of data across multiple servers
- `user_id % 3` ensures consistent routing
- Enables horizontal scaling

### 2. **Caching (Redis)**
- Fast in-memory storage
- Reduces database queries
- Improves response times

### 3. **WebSocket**
- Persistent connection for real-time updates
- Two-way communication
- Used for instant message delivery

### 4. **REST API**
- HTTP endpoints for CRUD operations
- Gateway routes requests to correct shard

### 5. **Message Persistence**
- PostgreSQL stores all messages permanently
- Indexed for fast retrieval
- Survives server restarts

---

## 🧪 Example Queries to Understand

### PostgreSQL Query - Get Conversation
```sql
SELECT * FROM messages
WHERE (from_user_id = '1' AND to_user_id = '2')
   OR (from_user_id = '2' AND to_user_id = '1')
ORDER BY created_at ASC
LIMIT 100;
```
**Result:** All messages between user 1 and 2, in chronological order

### Redis Cache - Check Conversation
```
Key: "conv:1:2"
Value: [JSON array of messages]
TTL: 300 seconds
```

### JavaScript - Route to Shard
```javascript
const userId = "7";
const shardIndex = 7 % 3;  // = 1
const shard = SHARDS[1];   // Shard 2 (index 1 = id 2)
// Send request to http://shard-2:4002/api/messages
```

---

## Next Steps

1. **Study Order:**
   - Run the system
   - Watch browser DevTools Network tab
   - See HTTP requests go to gateway
   - Check terminal logs for shard routing

2. **Experiment:**
   - Send message from User 1 to User 2
   - Check which shard handles it
   - Open database to see message stored
   - Change recipient to User 3, see different shard

3. **Extend:**
   - Add authentication (JWT)
   - Add message deletion
   - Add typing indicators
   - Add group chats

---

**Happy Learning!** 🚀
