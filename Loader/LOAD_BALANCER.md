# Load Balancer - Complete Guide

## What is a Load Balancer?

Think of it like a **receptionist at a busy office**:
- Many people (requests) arrive at the front desk
- The receptionist decides which employee (server) handles each person
- This prevents any single employee from being overwhelmed

```
WITHOUT Load Balancer:              WITH Load Balancer:
═══════════════════════             ═══════════════════════

  User 1 ────┐                        User 1 ────┐
  User 2 ────┼──→ Server 1 💀         User 2 ────┼──→ Load    ──→ Server 1 ✓
  User 3 ────┤    (overwhelmed)       User 3 ────┤    Balancer ──→ Server 2 ✓
  User 4 ────┘                        User 4 ────┘            ──→ Server 3 ✓
```

---

## How to Run This Demo

```bash
cd Loader
docker-compose up --build
```

Then open:
- **http://localhost:8080** - Demo UI with buttons
- **http://localhost/api/hello** - Direct API call through load balancer

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR BROWSER                            │
│                    http://localhost:8080                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NGINX LOAD BALANCER                        │
│                     http://localhost:80                         │
│                                                                 │
│   Receives ALL requests and distributes them to servers         │
└─────────────────────────────────────────────────────────────────┘
                │                │                │
                ▼                ▼                ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│     SERVER 1      │ │     SERVER 2      │ │     SERVER 3      │
│   Returns: green  │ │  Returns: blue    │ │ Returns: orange   │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

---

## Load Balancing Algorithms

### 1. Round Robin (Default)
Requests go in order: 1 → 2 → 3 → 1 → 2 → 3...

```
Request 1 → Server 1
Request 2 → Server 2
Request 3 → Server 3
Request 4 → Server 1  (back to start)
Request 5 → Server 2
...
```

**Good for:** Servers with equal capacity
**Config:**
```nginx
upstream backend {
    server server-1:3000;
    server server-2:3000;
    server server-3:3000;
}
```

### 2. Least Connections
Send to server with fewest active connections.

```
Server 1: 5 connections
Server 2: 2 connections  ← New request goes here
Server 3: 4 connections
```

**Good for:** Varying request durations (some fast, some slow)
**Config:**
```nginx
upstream backend {
    least_conn;
    server server-1:3000;
    server server-2:3000;
    server server-3:3000;
}
```

### 3. IP Hash
Same client always goes to same server.

```
Client 192.168.1.1 → Always Server 2
Client 192.168.1.2 → Always Server 1
Client 192.168.1.3 → Always Server 3
```

**Good for:** Session persistence (user stays logged in)
**Config:**
```nginx
upstream backend {
    ip_hash;
    server server-1:3000;
    server server-2:3000;
    server server-3:3000;
}
```

### 4. Weighted
Some servers get more traffic than others.

```
Server 1 (weight=3): Gets 3x traffic (powerful machine)
Server 2 (weight=2): Gets 2x traffic (medium machine)
Server 3 (weight=1): Gets 1x traffic (small machine)
```

**Good for:** Servers with different capacities
**Config:**
```nginx
upstream backend {
    server server-1:3000 weight=3;
    server server-2:3000 weight=2;
    server server-3:3000 weight=1;
}
```

---

## NGINX Deep Dive

### What is NGINX?

NGINX is a **web server** that can also work as:
- Load Balancer (what we're using it for)
- Reverse Proxy
- Static File Server
- SSL/TLS Terminator

### How NGINX Handles Requests

```
                         ┌─────────────────────────────────────┐
                         │              NGINX                   │
                         │                                      │
  HTTP Request ─────────→│  1. Receive request                  │
                         │  2. Look up upstream pool            │
                         │  3. Pick server using algorithm      │
                         │  4. Forward request to server        │
                         │  5. Get response from server         │
  HTTP Response ←────────│  6. Send response back to client     │
                         │                                      │
                         └─────────────────────────────────────┘
```

### Key NGINX Concepts

#### 1. Worker Processes
NGINX uses **event-driven architecture** (not thread-per-request):

```
Traditional Server:                 NGINX (Event-Driven):
═══════════════════                 ════════════════════

Request 1 → Thread 1                Request 1 ─┐
Request 2 → Thread 2                Request 2 ─┼→ Single Worker
Request 3 → Thread 3                Request 3 ─┤   (handles thousands)
...                                 Request 4 ─┘
Request 1000 → Thread 1000 💀
(runs out of memory)                Much more efficient!
```

#### 2. Upstream Block
Defines the pool of backend servers:

```nginx
upstream backend_servers {
    # Algorithm (optional, default is round-robin)
    least_conn;

    # List of servers
    server server-1:3000;
    server server-2:3000;
    server server-3:3000;

    # Keep connections alive for efficiency
    keepalive 32;
}
```

#### 3. Server Block
Defines how to handle incoming requests:

```nginx
server {
    listen 80;              # Listen on port 80

    location / {
        proxy_pass http://backend_servers;  # Forward to upstream
    }
}
```

---

## Interview Questions & Answers

### Q: What problem does a load balancer solve?

**A:** Three main problems:
1. **Scalability** - One server can only handle so many requests
2. **Availability** - If one server dies, others keep working
3. **Performance** - Distribute work evenly for faster responses

### Q: What's the difference between L4 and L7 load balancing?

**A:**
| Layer 4 (Transport) | Layer 7 (Application) |
|--------------------|-----------------------|
| Looks at: IP + Port | Looks at: HTTP headers, URLs, cookies |
| Faster (less parsing) | Smarter routing |
| Example: Route by source IP | Example: Route /api to API servers, /images to CDN |

NGINX does **L7 load balancing** (it understands HTTP).

### Q: How do you handle session persistence?

**A:** Several approaches:

1. **IP Hash** - Same IP goes to same server
   ```nginx
   ip_hash;
   ```

2. **Sticky Sessions** (cookie-based)
   ```nginx
   sticky cookie srv_id expires=1h;
   ```

3. **External Session Store** (best practice)
   - Store sessions in Redis
   - Any server can handle any request

### Q: What happens when a backend server dies?

**A:** NGINX automatically detects and removes it:

```nginx
upstream backend {
    server server-1:3000;
    server server-2:3000;
    server server-3:3000 backup;  # Only used if others fail
}
```

Health checks:
```nginx
upstream backend {
    server server-1:3000 max_fails=3 fail_timeout=30s;
}
```
- After 3 failures, server is marked "down" for 30 seconds

### Q: How do you scale a load balancer itself?

**A:**
1. **DNS Round Robin** - Multiple load balancer IPs
2. **Virtual IP (VRRP)** - Keepalived for failover
3. **Cloud Load Balancers** - AWS ALB/NLB, etc.

```
                    DNS
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        LB 1       LB 2       LB 3
          │          │          │
          └──────────┼──────────┘
                     ▼
              Backend Servers
```

### Q: NGINX vs HAProxy vs AWS ALB?

| Feature | NGINX | HAProxy | AWS ALB |
|---------|-------|---------|---------|
| Type | Web Server + LB | Pure LB | Managed LB |
| Layer | L7 | L4 & L7 | L7 |
| Config | nginx.conf | haproxy.cfg | AWS Console |
| Best for | Web apps | High performance | AWS apps |
| Cost | Free | Free | Pay-per-use |

---

## Experiments to Try

### Experiment 1: Round Robin vs Least Connections

1. Edit `nginx/nginx.conf`
2. Comment out `least_conn;`
3. Restart: `docker-compose restart nginx`
4. Click "Burst 10 Requests" - see even distribution

Then:
1. Add `least_conn;` back
2. Restart nginx
3. Click "Slow Request" multiple times
4. Notice how NGINX avoids busy servers

### Experiment 2: Weighted Distribution

1. Edit `nginx/nginx.conf`
2. Change server lines to:
   ```nginx
   server server-1:3000 weight=5;
   server server-2:3000 weight=3;
   server server-3:3000 weight=1;
   ```
3. Restart: `docker-compose restart nginx`
4. Send many requests - Server 1 gets most traffic

### Experiment 3: Kill a Server

1. Stop one server: `docker stop lb-server-2`
2. Send requests - only goes to Server 1 and 3
3. Start it back: `docker start lb-server-2`
4. Traffic includes Server 2 again

---

## Common Misconceptions

### "Load balancer makes my server faster"
❌ **Wrong** - It distributes load, doesn't speed up individual servers

### "I need a load balancer for 2 servers"
❌ **Depends** - Sometimes a single powerful server is simpler

### "Load balancer is a single point of failure"
❌ **Can be fixed** - Use multiple load balancers with failover

### "Round robin is always fair"
❌ **Wrong** - If requests have different durations, some servers get more work

---

## Quick Reference

### Start Demo
```bash
cd Loader
docker-compose up --build
```

### View Logs
```bash
docker-compose logs -f nginx      # Load balancer logs
docker-compose logs -f server-1   # Server 1 logs
```

### Restart After Config Change
```bash
docker-compose restart nginx
```

### Stop Everything
```bash
docker-compose down
```

### Test Directly
```bash
# Through load balancer
curl http://localhost/api/hello

# Multiple requests
for i in {1..10}; do curl -s http://localhost/api/hello | jq .server_id; done
```
