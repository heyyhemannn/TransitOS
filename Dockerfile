# Use Node.js 20 LTS slim image — Chromium installed for PDF receipt generation
FROM node:20-slim

# Install only minimal system dependencies needed by Baileys
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libssl-dev \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment
ENV PORT=4000
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create working directory
WORKDIR /app

# Copy root workspace configurations
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY apps/server/package.json ./apps/server/

# Install dependencies for all workspaces
RUN npm ci --include=dev

# Copy the rest of the monorepo files
COPY packages/types ./packages/types
COPY apps/server ./apps/server

# Generate Prisma Client
RUN npx prisma generate --schema=apps/server/prisma/schema.prisma

# Build shared types package and backend
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=apps/server

# Expose server port
EXPOSE 4000

# Start Express server
CMD ["node", "apps/server/dist/index.js"]
