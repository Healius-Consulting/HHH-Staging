FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY services/web/package.json services/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci
COPY services/api services/api
COPY packages/domain packages/domain
RUN npm run build --workspace @hhh/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY services/web/package.json services/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --workspace @hhh/api && npm cache clean --force
COPY --from=build /workspace/services/api/dist ./services/api/dist
USER node
CMD ["node", "services/api/dist/index.js"]
