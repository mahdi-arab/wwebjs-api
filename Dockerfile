# Use the official Node.js Debian image as the base image.
# node:24 has no linux/arm/v7 build, so 32-bit ARM stays on node:22.
FROM node:24-bookworm-slim AS node-amd64
FROM node:24-bookworm-slim AS node-arm64
FROM node:22-bookworm-slim AS node-arm
FROM node-${TARGETARCH} AS base

ENV CHROME_BIN="/usr/bin/chromium" \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    SCARF_ANALYTICS="false" \
    NODE_ENV="production"

WORKDIR /usr/src/app

FROM base AS deps

COPY package*.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# Create the final stage
FROM base

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    fonts-freefont-ttf \
    chromium \
    ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy only production dependencies from deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=deps /usr/src/app/package*.json ./

# Copy application code
COPY server.js ./
COPY LICENSE ./
COPY swagger.json ./
COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000

CMD ["npm", "start"]
