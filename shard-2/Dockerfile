FROM node:18-alpine
WORKDIR /app

# Copy shared shard-core code
COPY shared/shard-core/index.js ./shard-core.js
COPY shared/shard-core/replication.js ./replication.js

# Install dependencies
COPY shard-2/package.json .
RUN npm install

# Copy server code
COPY shard-2/server.js .

EXPOSE 4002
CMD ["npm", "start"]
