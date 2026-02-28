FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json biome.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/engine/package.json packages/engine/tsconfig.json packages/engine/
COPY packages/feed/package.json packages/feed/tsconfig.json packages/feed/
COPY propter-bsky-kit/ propter-bsky-kit/
RUN npm ci
COPY packages/shared/src packages/shared/src
COPY packages/engine/src packages/engine/src
COPY packages/feed/src packages/feed/src
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY propter-bsky-kit/ propter-bsky-kit/
RUN npm ci --omit=dev
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
CMD ["node", "packages/engine/dist/main.js"]
