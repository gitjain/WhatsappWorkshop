FROM node:18-alpine

WORKDIR /app

# Install http-server globally
RUN npm install -g http-server

COPY index.html .

EXPOSE 8080

CMD ["http-server", "-p", "8080", "-c-1"]
