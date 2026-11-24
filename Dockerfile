# The app: API + built web app in one image (ADR-001).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/context-server/package.json tools/context-server/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/app.sqlite NODE_NO_WARNINGS=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/context-server/package.json tools/context-server/
RUN npm ci --omit=dev -w apps/api --include-workspace-root=false && mkdir -p /data
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
COPY context/manifest.json context/manifest.json
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "apps/api/server.js"]
