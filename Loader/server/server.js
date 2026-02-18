/**
 * Simple Server for Load Balancer Demo
 *
 * This server does ONE thing: tells you which instance handled your request.
 * Perfect for visualizing how load balancers distribute traffic.
 */

const express = require('express');
const app = express();

// Enable CORS for the demo UI
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Each instance gets a unique ID from environment variable
const SERVER_ID = process.env.SERVER_ID || 'unknown';
const PORT = process.env.PORT || 3000;

// Track request count for this instance
let requestCount = 0;

app.use(express.json());

// Main endpoint - shows which server handled the request
app.get('/api/hello', (req, res) => {
  requestCount++;

  console.log(`[Server ${SERVER_ID}] Handling request #${requestCount}`);

  res.json({
    message: `Hello from Server ${SERVER_ID}!`,
    server_id: SERVER_ID,
    request_number: requestCount,
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server_id: SERVER_ID,
    total_requests: requestCount
  });
});

// Simulate slow response (to see load balancing better)
app.get('/api/slow', async (req, res) => {
  requestCount++;
  const delay = Math.random() * 2000 + 500; // 500-2500ms

  console.log(`[Server ${SERVER_ID}] Slow request, waiting ${Math.round(delay)}ms...`);

  await new Promise(resolve => setTimeout(resolve, delay));

  res.json({
    message: `Slow response from Server ${SERVER_ID}`,
    server_id: SERVER_ID,
    delay_ms: Math.round(delay),
    request_number: requestCount
  });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  res.json({
    server_id: SERVER_ID,
    total_requests: requestCount,
    uptime_seconds: Math.round(process.uptime())
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     SERVER ${SERVER_ID} STARTED                      ║
║     Port: ${PORT}                              ║
╚════════════════════════════════════════════╝
  `);
});
