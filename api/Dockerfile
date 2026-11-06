FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# 소스 전체 복사 (node_modules 등은 .dockerignore로 뺌) — 새 폴더를 추가해도 빠지지 않게
COPY . .
EXPOSE 3001
CMD ["node", "server.mjs"]
