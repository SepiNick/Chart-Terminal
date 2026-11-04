# Chart Terminal server image (linux/amd64 and linux/arm64, so a Raspberry Pi 4/5 works).
#   docker build -t chart-terminal .
# Private home server:  docker compose up -d         (docker-compose.yml, Linux host networking)
# Public server:        docker compose -f docker-compose.public.yml up -d   (with Caddy and automatic HTTPS)
FROM node:24-bookworm-slim AS ui
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
# openssl: the private server makes its own local CA for the home-network HTTPS. ARG ML=1 adds the Python libraries for the
# optional regime/pattern/journal tools (large on a Pi), leave it off if you do not use them.
ARG ML=0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && if [ "$ML" = "1" ]; then apt-get install -y --no-install-recommends python3-numpy python3-pandas python3-sklearn; fi \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY src ./src
COPY ml ./ml
COPY public ./public
COPY package.json ./package.json
COPY --from=ui /app/dist ./dist
ENV CT_DATA_DIR=/data CT_DIST_DIR=/app/dist NODE_ENV=production
VOLUME /data
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health',{headers:{host:'127.0.0.1'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.ts"]
