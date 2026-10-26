# syntax=docker/dockerfile:1
# Imagens de produção do monorepo (F0.02). Alvos: web, session, export.
#   docker build --target web --build-arg NEXT_PUBLIC_SUPABASE_URL=... .
# Nenhum segredo entra na imagem: só as variáveis NEXT_PUBLIC_*, que já são públicas.

ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@12.14.0 && npm cache clean --force
WORKDIR /repo
ENV CI=true

# ------------------------------------------------------------ web (Next.js)
FROM base AS web-build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@livro/web..."
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SESSION_WS_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SESSION_WS_URL=$NEXT_PUBLIC_SESSION_WS_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @livro/web build

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ------------------------------------------------------------ session (WebSocket)
FROM base AS session
COPY . .
RUN pnpm install --frozen-lockfile --filter "@livro/session..." && chown -R node:node /repo
WORKDIR /repo/apps/session
ENV NODE_ENV=production
USER node
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SESSION_PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/index.ts"]

# ------------------------------------------------------------ export (Pandoc)
FROM base AS export
ARG PANDOC_VERSION=3.12.1
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/pandoc.deb \
     "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-${TARGETARCH:-amd64}.deb" \
  && dpkg -i /tmp/pandoc.deb && rm /tmp/pandoc.deb \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile --filter "@livro/export..." && chown -R node:node /repo
WORKDIR /repo/services/export
ENV NODE_ENV=production
USER node
EXPOSE 4030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.EXPORT_PORT||4030)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/index.ts"]

# ------------------------------------------------------------ simuladores (staging até F1.03)
FROM base AS mocks
COPY . .
RUN pnpm install --frozen-lockfile --filter "@livro/test-kit..." && chown -R node:node /repo
WORKDIR /repo/tests/kit
USER node
EXPOSE 4010 4020 4040
CMD ["./node_modules/.bin/tsx", "src/mocks-cli.ts"]

# ------------------------------------------------------------ ops (backup e restauração, F0.08)
FROM base AS ops
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile --filter "@livro/ops..." && chown -R node:node /repo
WORKDIR /repo/tools/ops
USER node
ENTRYPOINT ["./node_modules/.bin/tsx", "src/cli.ts"]
