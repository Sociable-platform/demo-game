# syntax=docker/dockerfile:1
ARG VITE_CLAN_SDK_URL=http://127.0.0.1:18080/v1/clan-sdk.js

# The compiled TypeScript, browser assets and production npm dependencies are
# platform independent; node:sqlite comes from each target's Node runtime.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
COPY backend ./backend
COPY frontend ./frontend
ARG VITE_GAME_ID
ARG VITE_PLATFORM_URL
ARG VITE_SOCIAL_URL
ARG VITE_REALTIME_URL
ARG VITE_CLAN_SDK_URL
ENV VITE_GAME_ID=${VITE_GAME_ID} \
    VITE_PLATFORM_URL=${VITE_PLATFORM_URL} \
    VITE_SOCIAL_URL=${VITE_SOCIAL_URL} \
    VITE_REALTIME_URL=${VITE_REALTIME_URL} \
    VITE_CLAN_SDK_URL=${VITE_CLAN_SDK_URL}
RUN : "${VITE_GAME_ID:?VITE_GAME_ID build argument is required}" \
    && : "${VITE_PLATFORM_URL:?VITE_PLATFORM_URL build argument is required}" \
    && : "${VITE_SOCIAL_URL:?VITE_SOCIAL_URL build argument is required}" \
    && : "${VITE_REALTIME_URL:?VITE_REALTIME_URL build argument is required}" \
    && : "${VITE_CLAN_SDK_URL:?VITE_CLAN_SDK_URL must not be empty}" \
    && npm run build && npm prune --omit=dev \
    && mkdir -p /app/data && chown node:node /app/data

FROM node:22-alpine AS runtime
WORKDIR /app
ARG VITE_GAME_ID
ARG VITE_PLATFORM_URL
ARG VITE_SOCIAL_URL
ARG VITE_REALTIME_URL
ARG VITE_CLAN_SDK_URL
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/data/harvest.db \
    VITE_GAME_ID=${VITE_GAME_ID} \
    VITE_PLATFORM_URL=${VITE_PLATFORM_URL} \
    VITE_SOCIAL_URL=${VITE_SOCIAL_URL} \
    VITE_REALTIME_URL=${VITE_REALTIME_URL} \
    VITE_CLAN_SDK_URL=${VITE_CLAN_SDK_URL}
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/scripts/start-prod.mjs ./backend/scripts/start-prod.mjs
COPY --from=build /app/frontend/package.json ./frontend/
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build --chown=node:node /app/data/ /app/data/
USER node
EXPOSE 3001
CMD ["npm", "start"]
