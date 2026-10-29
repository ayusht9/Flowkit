FROM node:24-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends pandoc imagemagick ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV PANDOC_PATH=/usr/bin/pandoc IMAGEMAGICK_PATH=/usr/bin/convert
RUN npm test && npm run build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PANDOC_PATH=/usr/bin/pandoc IMAGEMAGICK_PATH=/usr/bin/convert
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node src ./src
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node examples/fixtures ./examples/fixtures
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
