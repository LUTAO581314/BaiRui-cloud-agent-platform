FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S bairui && adduser -S -G bairui bairui
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY server-agent ./server-agent
COPY upstreams/bailongma/brain-ui.html upstreams/bailongma/LICENSE upstreams/bailongma/package.json ./upstreams/bailongma/
COPY upstreams/bailongma/src/ui ./upstreams/bailongma/src/ui
USER bairui
EXPOSE 3000
CMD ["node", "apps/web/server.mjs"]
