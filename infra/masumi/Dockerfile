# The official 0.29.0 runner omits workspace sources needed by prisma/seed.ts.
# Restore them from the exact commit matching its OCI revision, without changing
# upstream application/contract code. No local .env is sent to this build.
FROM ghcr.io/masumi-network/masumi-payment-service@sha256:c7408906637858f121667e8e7fd973f2bda26c183eefc67eecacf9c09bf36ed9
COPY --from=masumi-source /packages ./packages
COPY --from=masumi-source /pnpm-lock.yaml /pnpm-workspace.yaml ./
COPY --from=masumi-source /patches ./patches
COPY --from=masumi-source /frontend/package.json ./frontend/package.json
RUN npm install --global pnpm@10.30.2
RUN pnpm install --offline --frozen-lockfile --ignore-scripts
CMD ["node", "dist/index.js"]
