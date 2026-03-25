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

# Install Prisma CLI so we can run migrations at container startup
RUN npm install -g prisma

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Copy schema + migrations so prisma migrate deploy can run at startup
COPY --from=builder /app/prisma ./prisma

# DB lives in a mounted volume at /data — override this with your own path via -e DATABASE_URL
ENV DATABASE_URL="file:/data/prod.db"
# /data is the persistent volume — mount your UNRAID path here
VOLUME ["/data"]

EXPOSE 3000
ENV PORT=3000

# Run migrations (idempotent — skips already-applied ones) then start the server
CMD sh -c "prisma migrate deploy && node server.js"
