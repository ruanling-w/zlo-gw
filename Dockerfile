FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build:all

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    ZALO_GATEWAY_HOST=0.0.0.0 \
    ZALO_GATEWAY_PORT=8787 \
    HERMES_BRIDGE_HOST=0.0.0.0 \
    HERMES_BRIDGE_PORT=8790 \
    ZALO_GATEWAY_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/README.md /app/LICENSE ./
VOLUME ["/data"]
EXPOSE 8787 8790
CMD ["node", "dist/app.js"]
