FROM node:24-bookworm-slim AS base
ARG PANDOC_VERSION=3.13
ARG PANDOC_SHA256=38aa33b325a2bc96a4c39409631212db55702f564250bcdbead180b3bf646389
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl groff ghostscript imagemagick ffmpeg ca-certificates \
    && curl -fsSL "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz" -o /tmp/pandoc.tar.gz \
    && echo "${PANDOC_SHA256}  /tmp/pandoc.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/pandoc.tar.gz --strip-components=1 -C /usr/local \
    && rm /tmp/pandoc.tar.gz \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV PANDOC_PATH=/usr/local/bin/pandoc IMAGEMAGICK_PATH=/usr/bin/convert
RUN npm test && npm run build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PANDOC_PATH=/usr/local/bin/pandoc IMAGEMAGICK_PATH=/usr/bin/convert
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node src ./src
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node examples/fixtures ./examples/fixtures
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
