# syntax=docker/dockerfile:1
#
# Texprove approval dashboard: production image.
# Build context is the dashboard/ folder (it holds shared/email too):
#   docker build -t texprove-dashboard:local dashboard
# Runs the Next.js standalone server on port 3000 as a non-root user.

ARG NODE_IMAGE=node:22.23-alpine

# ---- 1. dependencies (dev deps included: the build needs TypeScript and Tailwind).
# package-lock.json carries the musl builds of the native packages (SWC, Tailwind oxide,
# lightningcss), so no libc6-compat is needed.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The public/ folder is optional in Next.js; make sure it exists for the COPY below.
RUN mkdir -p public && npx next build

# ---- 3. runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The node image already ships a non-root "node" user (uid 1000); use our own
# dedicated user so the uid is explicit.
RUN addgroup -S -g 1001 nextjs && adduser -S -u 1001 -G nextjs nextjs

COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000

# /api/health must answer 200 without a session. Uses Node's fetch, so no curl/wget needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
