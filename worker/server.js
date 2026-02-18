/**
 * Message Worker - Consumes messages from RabbitMQ and writes to shards
 *
 * INTERVIEW NOTES:
 * ================
 * Q: Why use a message queue?
 * A: 1. DECOUPLING: Gateway doesn't wait for DB write (faster response)
 *    2. RELIABILITY: Messages survive crashes (persistent queue)
 *    3. SCALABILITY: Add more workers to handle more load
 *    4. TRAFFIC SPIKES: Queue absorbs bursts, workers process at steady rate
 *
 * Q: What happens if a worker crashes mid-processing?
 * A: Message acknowledgment! We only ACK after successful write.
 *    If worker dies, RabbitMQ re-delivers to another worker.
 *
 * Q: What is a Dead Letter Queue (DLQ)?
 * A: Failed messages (after retries) go to DLQ for manual inspection.
 *    Prevents poison messages from blocking the queue.
 *
 * Q: How do you ensure message ordering?
 * A: - Single queue + single consumer (simple but slow)
 *    - Partition by user ID (WhatsApp's approach)
 *    - Use message timestamps for eventual consistency
 */

const amqp = require('amqplib');
const axios = require('axios');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const WORKER_ID = process.env.WORKER_ID || '1';
const QUEUE_NAME = 'messages';
const DLQ_NAME = 'messages_dlq';  // Dead Letter Queue

// Shard configuration - same as gateway
const SHARDS = [
    { id: 1, url: 'http://shard-1:4001' },
    { id: 2, url: 'http://shard-2:4002' },
    { id: 3, url: 'http://shard-3:4003' }
];

// Determine which shard handles a user
function getShardForUser(userId) {
    const shardId = (Math.abs(parseInt(userId)) % SHARDS.length) || SHARDS.length;
    return SHARDS.find(s => s.id === shardId);
}

// Process a single message
async function processMessage(msg, channel) {
    const startTime = Date.now();
    let messageData;

    try {
        messageData = JSON.parse(msg.content.toString());
        console.log(`[WORKER-${WORKER_ID}] Processing message:`, {
            from: messageData.from_user_id,
            to: messageData.to_user_id,
            content: messageData.content.substring(0, 30) + '...'
        });

        // Route to correct shard based on sender
        const shard = getShardForUser(messageData.from_user_id);
        console.log(`[WORKER-${WORKER_ID}] Routing to Shard ${shard.id}`);

        // Write to shard
        const response = await axios.post(`${shard.url}/api/messages`, messageData, {
            timeout: 5000
        });

        const processingTime = Date.now() - startTime;
        console.log(`[WORKER-${WORKER_ID}] Message delivered to Shard ${shard.id} in ${processingTime}ms`);

        // SUCCESS: Acknowledge the message (removes from queue)
        // INTERVIEW: This is "at-least-once" delivery guarantee
        channel.ack(msg);

    } catch (error) {
        console.error(`[WORKER-${WORKER_ID}] Error processing message:`, error.message);

        // Check retry count from headers
        const retryCount = (msg.properties.headers?.['x-retry-count'] || 0);
        const maxRetries = 3;

        if (retryCount < maxRetries) {
            // RETRY: Reject and requeue with incremented retry count
            console.log(`[WORKER-${WORKER_ID}] Retrying (${retryCount + 1}/${maxRetries})...`);

            // Reject without requeue (will go to DLQ or we manually republish)
            channel.nack(msg, false, false);

            // Republish with retry count
            setTimeout(() => {
                channel.publish('', QUEUE_NAME, msg.content, {
                    persistent: true,
                    headers: { 'x-retry-count': retryCount + 1 }
                });
            }, 1000 * (retryCount + 1));  // Exponential backoff

        } else {
            // MAX RETRIES: Send to Dead Letter Queue
            console.error(`[WORKER-${WORKER_ID}] Max retries exceeded, sending to DLQ`);
            channel.nack(msg, false, false);  // This goes to DLQ
        }
    }
}

// Main worker loop
async function startWorker() {
    let connection;
    let channel;

    try {
        console.log(`[WORKER-${WORKER_ID}] Connecting to RabbitMQ at ${RABBITMQ_URL}`);

        // Retry connection with backoff
        let connected = false;
        let attempts = 0;
        while (!connected && attempts < 30) {
            try {
                connection = await amqp.connect(RABBITMQ_URL);
                connected = true;
            } catch (err) {
                attempts++;
                console.log(`[WORKER-${WORKER_ID}] RabbitMQ not ready, retrying in 2s... (${attempts}/30)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (!connected) {
            throw new Error('Could not connect to RabbitMQ after 30 attempts');
        }

        console.log(`[WORKER-${WORKER_ID}] Connected to RabbitMQ`);
        channel = await connection.createChannel();

        // INTERVIEW: Prefetch limits how many unacknowledged messages a worker can have
        // Lower = more even distribution, Higher = better throughput
        await channel.prefetch(10);

        // Declare the Dead Letter Queue first
        await channel.assertQueue(DLQ_NAME, {
            durable: true  // Survives broker restart
        });

        // Declare main queue with Dead Letter Exchange
        await channel.assertQueue(QUEUE_NAME, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': '',
                'x-dead-letter-routing-key': DLQ_NAME
            }
        });

        console.log(`[WORKER-${WORKER_ID}] Waiting for messages in queue: ${QUEUE_NAME}`);
        console.log(`[WORKER-${WORKER_ID}] Dead Letter Queue: ${DLQ_NAME}`);

        // Start consuming
        // INTERVIEW: "noAck: false" means we manually acknowledge
        channel.consume(QUEUE_NAME, (msg) => {
            if (msg) {
                processMessage(msg, channel);
            }
        }, { noAck: false });

        // Handle connection close
        connection.on('close', () => {
            console.error(`[WORKER-${WORKER_ID}] RabbitMQ connection closed, reconnecting...`);
            setTimeout(startWorker, 5000);
        });

        connection.on('error', (err) => {
            console.error(`[WORKER-${WORKER_ID}] RabbitMQ connection error:`, err.message);
        });

    } catch (error) {
        console.error(`[WORKER-${WORKER_ID}] Worker startup failed:`, error.message);
        setTimeout(startWorker, 5000);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(`[WORKER-${WORKER_ID}] Shutting down gracefully...`);
    process.exit(0);
});

// Start the worker
console.log(`
╔════════════════════════════════════════════════════════════════╗
║            MESSAGE WORKER ${WORKER_ID} - RabbitMQ Consumer             ║
╠════════════════════════════════════════════════════════════════╣
║  Queue: ${QUEUE_NAME.padEnd(50)}  ║
║  DLQ:   ${DLQ_NAME.padEnd(50)}  ║
╚════════════════════════════════════════════════════════════════╝
`);

startWorker();
