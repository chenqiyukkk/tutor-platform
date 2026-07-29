# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    SESSION_SECRET=build-only-session-secret-at-least-32-characters \
    APP_URL=http://localhost:3000
RUN npm run db:generate && npm run build

FROM base AS migration
ENV NODE_ENV=production \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src/lib/env.ts ./src/lib/env.ts
RUN npm run db:generate
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma.config.ts && npm run db:seed"]

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
