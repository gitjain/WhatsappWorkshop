/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                              CONSUMER (Worker)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This worker demonstrates the CONSUMER pattern in message queues:
 *
 * 1. Connects to RabbitMQ
 * 2. Listens for messages on a queue
 * 3. Processes each message (simulated with delay)
 * 4. Acknowledges completion (removes message from queue)
 *
 * KEY CONCEPTS:
 * - Competing Consumers: Multiple workers share the workload
 * - Manual Acknowledgment: Message only removed after successful processing
 * - Prefetch: Limits how many unacked messages a worker can hold
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const WORKER_ID = process.env.WORKER_ID || 'unknown';
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/internal/task-complete';
const QUEUE_NAME = 'tasks';

// Track statistics for this worker
let processedCount = 0;
let failedCount = 0;

// ═══════════════════════════════════════════════════════════════════════════
//                         CONNECT AND CONSUME
// ═══════════════════════════════════════════════════════════════════════════

async function startWorker() {
  try {
    console.log(`[Worker ${WORKER_ID}] Connecting to RabbitMQ...`);

    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Create queue if it doesn't exist
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    // ─────────────────────────────────────────────────────────────────────────
    // PREFETCH: Only take 1 message at a time
    // This ensures fair distribution among workers
    // ─────────────────────────────────────────────────────────────────────────
    channel.prefetch(1);

    console.log(`[Worker ${WORKER_ID}] Waiting for tasks on queue "${QUEUE_NAME}"...`);

    // ─────────────────────────────────────────────────────────────────────────
    // CONSUME: Listen for messages
    // noAck: false = we must manually acknowledge each message
    // ─────────────────────────────────────────────────────────────────────────
    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg === null) return;

      const startTime = Date.now();
      const task = JSON.parse(msg.content.toString());

      console.log(`[Worker ${WORKER_ID}] Received task: ${task.id}`);
      console.log(`[Worker ${WORKER_ID}] Processing for ${task.processingTime}ms...`);

      try {
        // ───────────────────────────────────────────────────────────────────────
        // SIMULATE WORK: In real life, this could be:
        // - Sending an email
        // - Processing an image
        // - Writing to a database
        // - Calling an external API
        // ───────────────────────────────────────────────────────────────────────
        await processTask(task);

        const processingTime = Date.now() - startTime;
        processedCount++;

        console.log(`[Worker ${WORKER_ID}] ✅ Completed task: ${task.id} in ${processingTime}ms`);

        // Notify producer (for demo tracking)
        await notifyCompletion(task.id, processingTime);

        // ───────────────────────────────────────────────────────────────────────
        // ACK: Acknowledge the message
        // This removes it from the queue - it won't be redelivered
        // ───────────────────────────────────────────────────────────────────────
        channel.ack(msg);

      } catch (error) {
        failedCount++;
        console.error(`[Worker ${WORKER_ID}] ❌ Failed task: ${task.id}`, error.message);

        // ───────────────────────────────────────────────────────────────────────
        // NACK: Negative acknowledgment
        // requeue: false = send to dead letter queue (if configured)
        // requeue: true = put back in queue for retry
        // ───────────────────────────────────────────────────────────────────────
        channel.nack(msg, false, false); // Don't requeue for this demo
      }

    }, { noAck: false }); // noAck: false = manual acknowledgment required

    // Handle connection close
    connection.on('close', () => {
      console.log(`[Worker ${WORKER_ID}] Connection closed. Reconnecting...`);
      setTimeout(startWorker, 5000);
    });

  } catch (error) {
    console.error(`[Worker ${WORKER_ID}] Connection failed:`, error.message);
    setTimeout(startWorker, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//                         TASK PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulates task processing with a delay
 * In real life, this would do actual work
 */
async function processTask(task) {
  // Simulate work with the specified processing time
  await new Promise(resolve => setTimeout(resolve, task.processingTime));

  // Simulate occasional failures (10% chance) for demo purposes
  if (Math.random() < 0.1) {
    throw new Error('Random failure for demonstration');
  }
}

/**
 * Notifies the producer that a task is complete (for demo UI)
 */
async function notifyCompletion(taskId, processingTime) {
  try {
    await fetch(CALLBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: taskId,
        workerId: WORKER_ID,
        processedAt: new Date().toISOString(),
        processingTime: processingTime
      })
    });
  } catch (error) {
    // Ignore callback errors - not critical for the demo
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//                              START WORKER
// ═══════════════════════════════════════════════════════════════════════════

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                           CONSUMER WORKER ${WORKER_ID}                               ║
║                                                                            ║
║   This worker will:                                                        ║
║   1. Connect to RabbitMQ                                                   ║
║   2. Listen for tasks on the queue                                         ║
║   3. Process each task (simulated delay)                                   ║
║   4. Acknowledge completion                                                ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
`);

startWorker();
