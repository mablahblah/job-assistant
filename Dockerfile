FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
# Prisma needs DATABASE_URL set at generate/build time even though no real DB is used
ENV DATABASE_URL="file:./dummy.db"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client (baked into the build)
RUN npx prisma generate
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# libsql uses native binaries that Next.js standalone bundler doesn't trace — copy them explicitly
COPY --from=builder /app/node_modules/@libsql ./node_modules/@libsql
COPY --from=builder /app/node_modules/libsql ./node_modules/libsql
# Copy schema + migrations + config so prisma migrate deploy can run at startup
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Install Prisma CLI + dotenv (prisma.config.ts imports it) for running migrations
RUN npm install prisma dotenv

# DB lives in a mounted volume at /data
ENV DATABASE_URL="file:/data/prod.db"
VOLUME ["/data"]

EXPOSE 3000
ENV PORT=3000
# Next.js standalone defaults to localhost — must bind to 0.0.0.0 to be reachable from outside the container
ENV HOSTNAME="0.0.0.0"

# Run migrations (idempotent — skips already-applied ones) then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
