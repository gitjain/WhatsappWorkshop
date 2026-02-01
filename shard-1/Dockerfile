FROM node:18-alpine
WORKDIR /app

# Copy shared shard-core code
COPY shared/shard-core/index.js ./shard-core.js
COPY shared/shard-core/replication.js ./replication.js

# Install dependencies
COPY shard-1/package.json .
RUN npm install

# Copy server code
COPY shard-1/server.js .

EXPOSE 4001
CMD ["npm", "start"]
