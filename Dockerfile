FROM node:22-alpine

WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy source code
COPY src ./src

# Run the TypeScript file
CMD ["npm", "start"]