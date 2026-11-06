FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
COPY boq ./boq
COPY meetings ./meetings
COPY labor ./labor
COPY space ./space
EXPOSE 3001
CMD ["node", "server.mjs"]
