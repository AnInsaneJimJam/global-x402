FROM node:22.22.1-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY packages ./packages
COPY workflows ./workflows
COPY tsconfig.json ./
RUN npm run build:web
USER node
ENV NODE_ENV=production HOST=0.0.0.0 EVIDENCE_STORAGE=POSTGRES
CMD ["node", "--import", "tsx", "apps/api/main.ts"]
