FROM oven/bun:1.3.14 AS bun
FROM node:22.22.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN curl -fSL https://github.com/smartcontractkit/cre-cli/releases/download/v1.37.0/cre_linux_amd64_ldd2-35.tar.gz -o /tmp/cre.tar.gz  && echo "3c8a73540ed78210ab3ed23d792d8a6bfb4e56deb49bc77d61dfbdd54a147155  /tmp/cre.tar.gz" | sha256sum -c -  && mkdir /tmp/cre-release && tar -xzf /tmp/cre.tar.gz -C /tmp/cre-release  && find /tmp/cre-release -type f -name 'cre*' -exec install -m 755 {} /usr/local/bin/cre \;  && rm -rf /tmp/cre-release /tmp/cre.tar.gz && cre version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY packages ./packages
COPY --chown=node:node workflows ./workflows
COPY infra/deploy/worker-start.mjs ./infra/deploy/worker-start.mjs
RUN cd workflows/cre-verify/verify-order && bun install --frozen-lockfile
RUN mkdir -p /home/node/.cre && chown node:node /home/node/.cre
USER node
ENV NODE_ENV=production EVIDENCE_STORAGE=POSTGRES CRE_BIN=/usr/local/bin/cre
CMD ["node", "infra/deploy/worker-start.mjs"]
