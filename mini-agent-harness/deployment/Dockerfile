FROM node:22.18-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

RUN mkdir -p /workspace && chown -R node:node /workspace /app
USER node

ENTRYPOINT ["node"]
CMD ["typescript/agent/releaseDemo.ts"]
