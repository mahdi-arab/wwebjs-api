# Use the official Node.js Debian image as the base image.
# Supported platforms: linux/amd64 and linux/arm64 (Node 24).
FROM node:24-bookworm-slim AS base

ENV CHROME_BIN="/usr/bin/chromium" \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    SCARF_ANALYTICS="false" \
    NODE_ENV="production"

WORKDIR /usr/src/app

FROM base AS deps

COPY package*.json .npmrc ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

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
COPY scripts/ ./scripts/

EXPOSE 3000

CMD ["npm", "start"]
