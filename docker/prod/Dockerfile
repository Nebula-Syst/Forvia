# syntax=docker/dockerfile:1
# Production images for Forvia — one Dockerfile, two targets, both built and pushed by
# .github/workflows/docker-publish.yml. Build context is the repo root:
#
#   docker build -f docker/prod/Dockerfile --target api .   # ghcr.io/nebula-syst/forvia-api
#   docker build -f docker/prod/Dockerfile --target web .   # ghcr.io/nebula-syst/forvia-web
#
# Always pass --target: without it Docker builds the last stage (web).

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

# ── api ──────────────────────────────────────────────────────────────────────────────────────

# Runtime dependencies only, installed exactly as locked (npm ci fails on a stale lockfile
# instead of silently resolving something else).
FROM node:25-alpine AS api-deps
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:25-alpine AS api

ARG VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL maintainer="Nebula Systems https://github.com/Nebula-Syst" \
    org.opencontainers.image.title="forvia-api" \
    org.opencontainers.image.description="Backend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://github.com/Nebula-Syst/forvia" \
    org.opencontainers.image.url="https://github.com/Nebula-Syst/forvia/pkgs/container/forvia-api" \
    org.opencontainers.image.documentation="https://github.com/Nebula-Syst/forvia#readme" \
    org.opencontainers.image.licenses="LicenseRef-PolyForm-Noncommercial-1.0.0" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

# tini: PID 1 that forwards SIGTERM, so `docker stop` doesn't wait out its 10 s timeout.
# su-exec: drops from root to `node` in the entrypoint once /data is owned by it.
RUN apk add --no-cache tini su-exec

WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY api/package.json api/server.js api/db.js ./
COPY --chmod=755 docker/prod/entrypoint.sh /usr/local/bin/forvia-entrypoint
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--", "forvia-entrypoint"]
CMD ["node", "server.js"]

HEALTHCHECK --start-period=10s \
            --interval=15s \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1

# ── web ──────────────────────────────────────────────────────────────────────────────────────

# Build the React app, then serve it with nginx.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:25-alpine AS web-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# Exactly as locked — npm ci fails on a stale lockfile instead of silently resolving something else.
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine AS web

ARG VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL maintainer="Nebula Systems https://github.com/Nebula-Syst" \
    org.opencontainers.image.title="forvia-web" \
    org.opencontainers.image.description="Frontend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://github.com/Nebula-Syst/forvia" \
    org.opencontainers.image.url="https://github.com/Nebula-Syst/forvia/pkgs/container/forvia-web" \
    org.opencontainers.image.documentation="https://github.com/Nebula-Syst/forvia#readme" \
    org.opencontainers.image.licenses="LicenseRef-PolyForm-Noncommercial-1.0.0" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /app/dist /usr/share/nginx/html
# exercise media (img/gif) is mounted at runtime from the media volume

# Set Default ENVs for nginx
ENV NGINX_PORT=80
ENV BACKEND=api
ENV PORT=3000
# forvia-core — the sibling backend service (see nginx.conf.template's own comment for which
# routes go where).
ENV CORE_BACKEND=core-api
ENV CORE_PORT=3000

# Probe the port nginx was actually told to listen on (NGINX_PORT is configurable, so a
# hardcoded http://localhost/ breaks on any instance that changed it), and address it as
# 127.0.0.1: envsubst rewrites the conf after the image's IPv6 script, so nginx ends up
# listening on IPv4 only while "localhost" resolves to ::1 first.
HEALTHCHECK --start-period=10s \
            --interval=15s \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}/" || exit 1
