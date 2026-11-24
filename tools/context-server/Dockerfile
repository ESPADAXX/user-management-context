# The context server, reading a mounted context/ folder.  Build from the repo root:
#   docker build -f tools/context-server/Dockerfile -t context-server .
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/context-server/package.json tools/context-server/
RUN npm ci --omit=dev -w tools/context-server
COPY scripts/context scripts/context
COPY tools/context-server tools/context-server
COPY context context
ENV CONTEXT_PORT=4000 CONTEXT_ROOT=/app
EXPOSE 4000
CMD ["node", "tools/context-server/src/index.js", "--http"]
