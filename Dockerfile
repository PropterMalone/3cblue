FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json biome.json ./
COPY propter-bsky-kit/ propter-bsky-kit/
RUN npm ci
COPY src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY propter-bsky-kit/ propter-bsky-kit/
RUN npm ci --omit=dev
COPY --from=build /app/dist dist
CMD ["node", "dist/main.js"]
