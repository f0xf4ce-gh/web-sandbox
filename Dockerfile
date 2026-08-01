# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS build

WORKDIR /src

COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        g++ \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm ci

COPY client ./client
COPY assets ./assets
COPY inject ./inject
COPY server ./server
COPY tsconfig.json tsconfig.inject.json tsconfig.server.json vite.config.ts ./

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS runtime

USER root

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        ca-certificates \
        fd-find \
        fzf \
        git \
        neovim \
        ripgrep \
        tmux \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /src/dist /app/dist
COPY --from=build --chown=node:node /src/dist-inject /app/dist-inject
COPY --from=build --chown=node:node /src/dist-server /app/dist-server
COPY --from=build --chown=node:node /src/node_modules /app/node_modules

RUN mkdir -p /workspace \
    && chown node:node /workspace

USER node
WORKDIR /workspace

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "/app/dist-server/index.js"]
