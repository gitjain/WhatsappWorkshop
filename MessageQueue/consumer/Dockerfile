FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY worker.js .
CMD ["npm", "start"]
