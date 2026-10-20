# syntax=docker/dockerfile:1
# Satu image: API (NestJS) + web admin (/) + aplikasi mobile versi web (/m), satu port.

# ---------- build ----------
FROM node:24-bookworm-slim AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.0.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @sajadah/shared build \
 && pnpm --filter @sajadah/web build \
 && pnpm --filter @sajadah/mobile build:web \
 && pnpm --filter @sajadah/api build

# Salinan dependensi PRODUKSI API saja (tanpa expo/react-native/dev tools): jauh lebih kecil.
RUN pnpm --filter @sajadah/api deploy --prod --legacy /prod/api

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 SEED=false TRUST_PROXY=true \
    PRODUCT_IMAGE_DIR=/data/products AVATAR_DIR=/data/avatars VOUCHER_IMAGE_DIR=/data/vouchers
WORKDIR /app/apps/api
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/api/data ./data
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --from=build /app/apps/mobile/dist-web /app/apps/mobile/dist-web
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
