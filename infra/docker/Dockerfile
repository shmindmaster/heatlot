# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 python3-pip \
 && pip3 install --break-system-packages "schemathesis==4.29.1" \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts \
 && npx playwright install --with-deps chromium-headless-shell

COPY . .

CMD ["npm", "run", "verify:all"]
