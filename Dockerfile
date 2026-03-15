FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "src/handlers/local.js"]
