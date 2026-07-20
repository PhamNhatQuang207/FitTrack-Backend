# syntax=docker/dockerfile:1

# ---- Base image -------------------------------------------------------------
# Alpine keeps the image small; Node 24 matches the toolchain used in CI.
FROM node:24-alpine AS production

# tini gives us a proper PID 1 that reaps zombies and forwards signals
# (so SIGTERM from `docker stop` / Render actually shuts the app down cleanly).
RUN apk add --no-cache tini

# Production runtime settings. NODE_ENV=production also keeps rate limiting ON
# (see src/middleware/rateLimiter.js, which fails closed unless NODE_ENV=development).
ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Install ONLY production dependencies, using the lockfile for reproducible builds.
# Copying just the manifests first lets Docker cache this layer until deps change.
# --omit=dev skips jest / supertest / mongodb-memory-server (no mongod download).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the application source (node_modules, .env, tests, etc. are excluded via .dockerignore).
COPY . .

# Drop root: the official image ships an unprivileged "node" user.
USER node

EXPOSE 5000

# Container-level health check against the app's own endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-5000}/api/health" || exit 1

# tini as entrypoint, then start the server.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]
