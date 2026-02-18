/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                              PRODUCER (API Server)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This server demonstrates the PRODUCER pattern in message queues:
 *
 * 1. Receives HTTP requests from clients
 * 2. Publishes messages to RabbitMQ
 * 3. Returns IMMEDIATELY (doesn't wait for processing)
 *
 * KEY CONCEPT: Async processing!
 * The client gets a fast response, while the actual work happens later.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

// Enable CORS for the demo UI
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const PORT = process.env.PORT || 3000;
const QUEUE_NAME = 'tasks';

let channel = null;
let taskCounter = 0;

// Store for completed tasks (for demo purposes)
const completedTasks = [];
const pendingTasks = new Map();

// ═══════════════════════════════════════════════════════════════════════════
//                         CONNECT TO RABBITMQ
// ═══════════════════════════════════════════════════════════════════════════

async function connectToRabbitMQ() {
  try {
    console.log('Connecting to RabbitMQ...');
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Create the queue if it doesn't exist
    // durable: true = queue survives broker restart
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    console.log(`Connected to RabbitMQ! Queue "${QUEUE_NAME}" ready.`);
  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', error.message);
    // Retry after 5 seconds
    setTimeout(connectToRabbitMQ, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//                              API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/task
 *
 * Submits a new task to the queue.
 * Returns immediately with a task ID - doesn't wait for processing!
 */
app.post('/api/task', async (req, res) => {
  if (!channel) {
    return res.status(503).json({ error: 'Queue not available' });
  }

  taskCounter++;
  const taskId = `task-${taskCounter}`;
  const processingTime = req.body.processingTime || Math.floor(Math.random() * 3000) + 1000;

  const task = {
    id: taskId,
    type: req.body.type || 'default',
    data: req.body.data || `Task #${taskCounter}`,
    processingTime: processingTime,
    createdAt: new Date().toISOString()
  };

  // Track pending task
  pendingTasks.set(taskId, { ...task, status: 'queued' });

  // ─────────────────────────────────────────────────────────────────────────
  // THIS IS THE KEY PART: Publish to queue and return immediately!
  // ─────────────────────────────────────────────────────────────────────────
  channel.sendToQueue(
    QUEUE_NAME,
    Buffer.from(JSON.stringify(task)),
    { persistent: true }  // Message survives broker restart
  );

  console.log(`[Producer] Published task: ${taskId} (will take ${processingTime}ms)`);

  // Return immediately - client doesn't wait for processing!
  res.status(202).json({
    message: 'Task queued for processing',
    taskId: taskId,
    status: 'queued',
    estimatedTime: `${processingTime}ms`
  });
});

/**
 * POST /api/burst
 *
 * Submits multiple tasks at once (for demo purposes)
 */
app.post('/api/burst', async (req, res) => {
  if (!channel) {
    return res.status(503).json({ error: 'Queue not available' });
  }

  const count = req.body.count || 10;
  const tasks = [];

  for (let i = 0; i < count; i++) {
    taskCounter++;
    const taskId = `task-${taskCounter}`;
    const processingTime = Math.floor(Math.random() * 3000) + 1000;

    const task = {
      id: taskId,
      type: 'burst',
      data: `Burst task #${i + 1}`,
      processingTime: processingTime,
      createdAt: new Date().toISOString()
    };

    pendingTasks.set(taskId, { ...task, status: 'queued' });

    channel.sendToQueue(
      QUEUE_NAME,
      Buffer.from(JSON.stringify(task)),
      { persistent: true }
    );

    tasks.push({ taskId, processingTime });
  }

  console.log(`[Producer] Published ${count} burst tasks`);

  res.status(202).json({
    message: `${count} tasks queued for processing`,
    tasks: tasks
  });
});

/**
 * POST /internal/task-complete
 *
 * Called by consumers when a task is complete (for demo tracking)
 */
app.post('/internal/task-complete', (req, res) => {
  const { taskId, workerId, processedAt, processingTime } = req.body;

  const task = pendingTasks.get(taskId);
  if (task) {
    pendingTasks.delete(taskId);
    completedTasks.unshift({
      ...task,
      status: 'completed',
      workerId: workerId,
      processedAt: processedAt,
      actualProcessingTime: processingTime
    });

    // Keep only last 50 completed tasks
    if (completedTasks.length > 50) {
      completedTasks.pop();
    }
  }

  res.sendStatus(200);
});

/**
 * GET /api/status
 *
 * Returns current queue status (for demo UI)
 */
app.get('/api/status', (req, res) => {
  res.json({
    pending: Array.from(pendingTasks.values()),
    completed: completedTasks.slice(0, 20),
    stats: {
      totalCreated: taskCounter,
      pendingCount: pendingTasks.size,
      completedCount: completedTasks.length
    }
  });
});

/**
 * DELETE /api/clear
 *
 * Clears all tracking data (for demo purposes)
 */
app.delete('/api/clear', (req, res) => {
  pendingTasks.clear();
  completedTasks.length = 0;
  taskCounter = 0;
  res.json({ message: 'Cleared all task data' });
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    queueConnected: channel !== null
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//                              START SERVER
// ═══════════════════════════════════════════════════════════════════════════

app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                           PRODUCER SERVER                                  ║
║                                                                            ║
║   API Server: http://localhost:${PORT}                                       ║
║                                                                            ║
║   Endpoints:                                                               ║
║   POST /api/task   - Submit a single task                                  ║
║   POST /api/burst  - Submit multiple tasks                                 ║
║   GET  /api/status - Get queue status                                      ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
  `);

  await connectToRabbitMQ();
});
