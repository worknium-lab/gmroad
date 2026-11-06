# WORKNIUM 라이선스 서버 (고객사에는 설치하지 않음)
#   빌드: 저장소 맨 위에서  docker compose --profile license up -d --build
FROM node:22-alpine
WORKDIR /app
COPY licensing/server/package.json licensing/server/package-lock.json ./
RUN npm ci --omit=dev
COPY licensing/server/server.mjs licensing/server/admin.html ./
COPY api/license/token.mjs ./token.mjs
VOLUME /data
EXPOSE 3100
CMD ["node", "server.mjs"]
