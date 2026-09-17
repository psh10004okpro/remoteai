FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol ./packages/protocol
COPY apps/server ./apps/server
COPY apps/web ./apps/web

RUN npm install --workspace=@remoteai/protocol --workspace=@remoteai/server --workspace=@remoteai/web --include-workspace-root \
  && npm run build -w @remoteai/web

ENV NODE_ENV=production
ENV PORT=18790
ENV DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 18790

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||18790)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx","tsx","apps/server/src/index.ts"]
