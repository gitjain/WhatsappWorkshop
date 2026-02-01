# WhatsApp-like Distributed Messaging System

A complete demonstration of a scalable, distributed messaging system built with Docker, featuring horizontal sharding, caching, and a real-time web client.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     HTML Client (Browser)                    │
│                    (WebSocket + REST API)                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
            ┌────────────────────────────┐
            │     API Gateway (Port 3000)│
            │   (Request Routing)        │
            └─────┬──────────┬──────────┬┘
                  │          │          │
        ┌─────────▼─┐  ┌────▼──┐  ┌──▼─────┐
        │ Shard 1   │  │ Shard2 │  │ Shard 3│
        │ (4001)    │  │(4002)  │  │ (4003) │
        │ Node.js   │  │Node.js │  │Node.js │
        │ WebSocket │  │WebSocket   WebSocket
        └─────┬──────┘  └────┬──┘  └──┬──────┘
              │             │         │
              └─────────────┼─────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
         ┌────▼────────────┐      ┌───────▼──────┐
         │  PostgreSQL     │      │    Redis     │
         │  (Persistent)   │      │   (Cache)    │
         │   Port 5432     │      │  Port 6379   │
         └─────────────────┘      └──────────────┘
```

## 🎯 Key Features

### 1. **Horizontal Sharding**
- Messages are sharded by `user_id % 3`
- Gateway automatically routes requests to the correct shard
- Enables horizontal scaling: add more shards as needed

### 2. **Message Shards (Node.js)**
- 3 independent message servers running in parallel
- HTTP REST endpoints for message operations
- WebSocket support for real-time messaging
- Redis integration for conversation caching
- PostgreSQL for persistent storage

### 3. **API Gateway**
- Express.js server acting as entry point
- Routes all requests to appropriate shards
- Health checks for all shards
- User and message endpoints

### 4. **Data Persistence**
- **PostgreSQL**: Stores all messages with full history
- **Redis**: Caches recent conversations for faster retrieval
- Automatic cache invalidation on new messages

### 5. **Real-Time Client**
- Modern HTML5 web client
- WebSocket support for real-time messaging
- Beautiful, responsive UI
- System health monitoring dashboard

## 📋 System Components

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Gateway | 3000 | Request router and load balancer |
| Shard-1 | 4001 | Message shard 1 |
| Shard-2 | 4002 | Message shard 2 |
| Shard-3 | 4003 | Message shard 3 |
| PostgreSQL | 5432 | Persistent message storage |
| Redis | 6379 | Caching layer |
| Client | 8080 | Web UI |

### Directory Structure

```
.
├── gateway/              # API Gateway service
│   ├── Dockerfile       # Gateway container
│   ├── package.json     # Dependencies
│   └── server.js        # Main server file
├── shard-1/             # Shard 1 service
├── shard-2/             # Shard 2 service
├── shard-3/             # Shard 3 service
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── postgres/            # Database initialization
│   └── init.sql         # Schema and sample data
├── client/              # Web client
│   ├── Dockerfile
│   └── index.html       # Web UI
├── docker-compose.yml   # Container orchestration
└── README.md            # This file
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose installed
- Port 3000, 4001-4003, 5432, 6379, 8080 available

### Installation & Startup

1. **Clone/Navigate to the project**
   ```bash
   cd c:\Workshops\Whatsapp
   ```

2. **Build and start all services**
   ```bash
   docker-compose up --build
   ```

   This will:
   - Build Docker images for gateway, shards, and client
   - Start PostgreSQL and Redis
   - Initialize the database with sample data
   - Start all 3 shards
   - Start the API gateway
   - Start the web client

3. **Access the application**
   - Open browser: `http://localhost:8080`
   - API Gateway: `http://localhost:3000`
   - Check logs: `docker-compose logs -f`

### Shutdown

```bash
docker-compose down
```

To also remove volumes:
```bash
docker-compose down -v
```

## 🧪 Usage Examples

### 1. Using the Web Client

1. Register as a user (e.g., User 1)
2. View available users in the left panel
3. Click a user to start a conversation
4. Type messages and send them
5. Messages appear in real-time
6. Check shard health status

### 2. Using REST API

**Send a message:**
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "from_user_id": "1",
    "to_user_id": "2",
    "content": "Hello World!"
  }'
```

**Get conversation between two users:**
```bash
curl http://localhost:3000/api/conversations/1/2
```

**Get all users:**
```bash
curl http://localhost:3000/api/users
```

**Get all messages for a user:**
```bash
curl http://localhost:3000/api/messages/1
```

**Check shard health:**
```bash
curl http://localhost:3000/api/health/shards
```

**Check gateway health:**
```bash
curl http://localhost:3000/health
```

## 📊 API Endpoints

### Gateway API (Port 3000)

#### Health Checks
- `GET /health` - Gateway health
- `GET /api/health/shards` - All shards health status

#### Messages
- `POST /api/messages` - Send a message
- `GET /api/messages/:userId` - Get all messages for user
- `GET /api/conversations/:userId/:otherUserId` - Get conversation

#### System
- `GET /api/users` - Get all users
- `GET /api/shards` - Get shard information

### Shard API (Ports 4001-4003)

Same endpoints as Gateway, but operates on specific shard only:
- `GET /health`
- `POST /api/messages`
- `GET /api/messages/:userId`
- `GET /api/conversations/:userId/:otherUserId`
- `GET /api/users`

### WebSocket API

Connect to: `ws://localhost:400X/ws` (where X is shard number)

**Message types:**
```json
{
  "type": "register",
  "user_id": "1"
}
```

```json
{
  "type": "send_message",
  "from_user_id": "1",
  "to_user_id": "2",
  "content": "Hello!"
}
```

## 🔧 Configuration

### Environment Variables

Edit `.env` file to customize:

```env
# Database
POSTGRES_DB=whatsapp
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Redis
REDIS_URL=redis://redis:6379

# Ports
GATEWAY_PORT=3000
SHARD_1_PORT=4001
SHARD_2_PORT=4002
SHARD_3_PORT=4003
CLIENT_PORT=8080
```

## 🔐 Sharding Logic

Messages are distributed across shards using:

```
shard_id = user_id % number_of_shards
```

Example:
- User 1 → Shard 1 (1 % 3 = 1)
- User 2 → Shard 2 (2 % 3 = 2)
- User 3 → Shard 3 (3 % 3 = 0, wraps to 3)
- User 4 → Shard 1 (4 % 3 = 1)

This ensures:
- Consistent routing (same user always goes to same shard)
- Balanced distribution
- Easy horizontal scaling

## 📈 Scaling Considerations

### Adding More Shards

To add a new shard:

1. Create `shard-4/` directory with same structure
2. Update `docker-compose.yml` to include `shard-4` service
3. Update `SHARDS` array in `gateway/server.js`
4. Rebuild and restart: `docker-compose up --build`

### Load Balancing

For production:
- Use Kubernetes or container orchestration
- Add load balancer (nginx, HAProxy)
- Implement consistent hashing for better distribution
- Add replica shards for redundancy

### Database Optimization

- Add read replicas
- Implement connection pooling
- Use query optimization
- Consider time-series databases for archival

## 🔄 Message Flow

1. **Client sends message** → POST `/api/messages`
2. **Gateway calculates shard** → `user_id % 3`
3. **Routes to shard** → HTTP POST to shard service
4. **Shard processes message:**
   - Stores in PostgreSQL
   - Caches in Redis
   - Sends real-time notification if recipient connected
5. **Response returns** → Message ID + shard info
6. **Client displays** → Message appears in conversation

## 📝 Database Schema

### Messages Table

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  from_user_id VARCHAR(50) NOT NULL,
  to_user_id VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE,
  shard_id VARCHAR(10)
);
```

Indexes on:
- `from_user_id`
- `to_user_id`
- `from_user_id, to_user_id` (conversation lookups)
- `shard_id` (shard queries)
- `created_at DESC` (chronological order)

## 🧪 Testing

### Load Testing

```bash
# Install Apache Bench
# On Windows: choco install apache-bench

ab -n 1000 -c 10 http://localhost:3000/health
```

### Database Testing

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U postgres -d whatsapp

# View messages
SELECT * FROM messages;

# Count messages per shard
SELECT shard_id, COUNT(*) FROM messages GROUP BY shard_id;
```

### Redis Testing

```bash
# Connect to Redis
docker-compose exec redis redis-cli

# View cached conversations
KEYS *conv*

# Check cache size
INFO memory
```

## 🐛 Troubleshooting

### Services won't start

```bash
# Check logs
docker-compose logs -f

# Check specific service
docker-compose logs -f shard-1

# Rebuild from scratch
docker-compose down -v
docker-compose up --build
```

### Cannot connect to gateway

- Verify all services are running: `docker-compose ps`
- Check port availability: `netstat -ano | findstr :3000`
- Check gateway logs: `docker-compose logs gateway`

### Messages not persisting

- Check PostgreSQL: `docker-compose logs postgres`
- Verify database initialized: `docker-compose exec postgres psql -U postgres -d whatsapp -c "SELECT COUNT(*) FROM messages;"`

### WebSocket connection issues

- Check shard logs for errors
- Verify shard is running on correct port
- Check firewall settings

## 📚 Technologies Used

- **Node.js + Express**: Gateway and shards
- **WebSocket (ws)**: Real-time messaging
- **PostgreSQL**: Persistent storage
- **Redis**: Caching layer
- **Docker & Docker Compose**: Containerization
- **HTML5 + CSS3 + JavaScript**: Web client

## 🎓 Learning Outcomes

This system demonstrates:

✅ Distributed system architecture
✅ Database sharding strategies
✅ Caching patterns (Redis)
✅ Real-time messaging (WebSocket)
✅ API Gateway pattern
✅ Horizontal scaling
✅ Container orchestration (Docker)
✅ PostgreSQL optimization
✅ Load balancing concepts

## 🤝 Further Enhancements

- [ ] Message encryption (E2E)
- [ ] User authentication (JWT)
- [ ] Message search capabilities
- [ ] Group messaging
- [ ] Media file uploads
- [ ] Message delivery receipts
- [ ] Typing indicators
- [ ] Read receipts
- [ ] Kubernetes deployment
- [ ] Monitoring (Prometheus/Grafana)
- [ ] Service mesh (Istio)
- [ ] Event sourcing
- [ ] CQRS pattern

## 📄 License

MIT License - Feel free to use for educational purposes

## 🚀 Next Steps

1. Start the system: `docker-compose up --build`
2. Open `http://localhost:8080` in browser
3. Register as User 1
4. Open another browser/tab and register as User 2
5. Send messages between them
6. Observe real-time delivery and persistence

---

**Happy Messaging!** 💬
