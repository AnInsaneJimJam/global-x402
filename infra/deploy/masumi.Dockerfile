FROM node:22.22.1-bookworm-slim AS source
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 0.29.0 https://github.com/masumi-network/masumi-payment-service.git /source  && test "$(git -C /source rev-parse HEAD)" = "71455701ac22c3380c50da54089e1b7363f6825d"
FROM ghcr.io/masumi-network/masumi-payment-service@sha256:c7408906637858f121667e8e7fd973f2bda26c183eefc67eecacf9c09bf36ed9
COPY --from=source /source/packages ./packages
COPY --from=source /source/pnpm-lock.yaml /source/pnpm-workspace.yaml ./
COPY --from=source /source/patches ./patches
COPY --from=source /source/frontend/package.json ./frontend/package.json
RUN npm install --global pnpm@10.30.2 && pnpm install --offline --frozen-lockfile --ignore-scripts
COPY infra/masumi/prisma-tool.mjs /opt/gob/prisma-tool.mjs
COPY infra/deploy/masumi-start.mjs /opt/gob/masumi-start.mjs
CMD ["node", "/opt/gob/masumi-start.mjs"]
