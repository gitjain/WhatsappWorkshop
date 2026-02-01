FROM node:18-alpine
WORKDIR /app

# Copy shared shard-core code
COPY shared/shard-core/index.js ./shard-core.js

# Install dependencies
COPY shard-3/package.json .
RUN npm install

# Copy server code
COPY shard-3/server.js .

EXPOSE 4003
CMD ["npm", "start"]
