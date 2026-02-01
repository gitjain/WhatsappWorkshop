/**
 * WebSocket Handler
 * Manages real-time WebSocket connections and message streaming
 */

const { v4: uuidv4 } = require('uuid');

function setupWebSocketHandler(wss, pool, redisClient, shardId, connectedClients) {
  
  wss.on('connection', (ws, req) => {
    console.log(`[SHARD-${shardId}] New WebSocket connection`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`[SHARD-${shardId}] Received WebSocket message:`, message.type);

        // User registration on WebSocket
        if (message.type === 'register') {
          handleUserRegistration(ws, message, shardId, connectedClients);
        }
        // Send message via WebSocket
        else if (message.type === 'send_message') {
          await handleWebSocketMessage(
            ws, message, shardId, pool, redisClient, connectedClients
          );
        }
      } catch (error) {
        console.error(`[SHARD-${shardId}] WebSocket error:`, error.message);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });

    ws.on('close', () => {
      handleClientDisconnection(ws, shardId, connectedClients);
    });

    ws.on('error', (error) => {
      console.error(`[SHARD-${shardId}] WebSocket connection error:`, error.message);
    });
  });
}

/**
 * Handle user registration for WebSocket connection
 */
function handleUserRegistration(ws, message, shardId, connectedClients) {
  const userId = message.user_id;
  connectedClients.set(userId, ws);
  console.log(`[SHARD-${shardId}] User ${userId} registered on WebSocket`);
  
  ws.send(JSON.stringify({
    type: 'registered',
    user_id: userId,
    shard_id: shardId
  }));
}

/**
 * Handle incoming WebSocket message
 */
async function handleWebSocketMessage(ws, message, shardId, pool, redisClient, connectedClients) {
  const { from_user_id, to_user_id, content } = message;
  const messageId = uuidv4();
  const timestamp = new Date();

  try {
    // Save to database
    await pool.query(
      `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, shard_id) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [messageId, from_user_id, to_user_id, content, timestamp, shardId]
    );

    // Invalidate conversation cache
    await redisClient.del(`conv:${from_user_id}:${to_user_id}`);
    await redisClient.del(`conv:${to_user_id}:${from_user_id}`);

    const msgData = {
      type: 'message',
      id: messageId,
      from_user_id,
      to_user_id,
      content,
      created_at: timestamp
    };

    // Send to recipient if connected
    if (connectedClients.has(to_user_id)) {
      const recipientWs = connectedClients.get(to_user_id);
      recipientWs.send(JSON.stringify(msgData));
    }

    // Send confirmation to sender
    ws.send(JSON.stringify({
      type: 'message_sent',
      id: messageId,
      status: 'delivered'
    }));

    console.log(`[SHARD-${shardId}] WebSocket message from ${from_user_id} to ${to_user_id}`);
  } catch (error) {
    console.error(`[SHARD-${shardId}] Error handling WebSocket message:`, error.message);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to send message'
    }));
  }
}

/**
 * Handle client disconnection
 */
function handleClientDisconnection(ws, shardId, connectedClients) {
  for (const [userId, clientWs] of connectedClients.entries()) {
    if (clientWs === ws) {
      connectedClients.delete(userId);
      console.log(`[SHARD-${shardId}] User ${userId} disconnected from WebSocket`);
      break;
    }
  }
}

module.exports = { setupWebSocketHandler };
