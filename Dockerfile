FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY ui ./ui
COPY vendor ./vendor
COPY scripts ./scripts
COPY supplier-fixtures ./supplier-fixtures
RUN npm run build && mkdir -p /app/.data && chown -R node:node /app/.data
USER node
ENV HOST=0.0.0.0 PORT=4173 SAMPLE_MODE=true DATA_DIR=/app/.data
EXPOSE 4173
CMD ["npm", "start"]
