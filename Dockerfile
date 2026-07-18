FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS bailongma-ui
WORKDIR /app
COPY packages/bailongma-ui ./packages/bailongma-ui
COPY scripts/build-bailongma-ui.mjs ./scripts/build-bailongma-ui.mjs
COPY patches/bailongma ./patches/bailongma
COPY upstreams/bailongma ./upstreams/bailongma
RUN node scripts/build-bailongma-ui.mjs

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache docker-cli \
    && addgroup -S bairui \
    && adduser -S -G bairui bairui \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY server-agent ./server-agent
COPY --from=bailongma-ui /app/build/bailongma-ui ./build/bailongma-ui
USER bairui
EXPOSE 3000
CMD ["node", "apps/web/server.mjs"]
