FROM node:20-alpine

WORKDIR /app

# Production mode: Express returns generic error pages instead of stack traces
ENV NODE_ENV=production

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "src/handlers/local.js"]
