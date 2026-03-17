FROM node:22-alpine
WORKDIR /app

COPY v2-pixel/package.json v2-pixel/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY v2-pixel/server.js .
COPY v2-pixel/public/ ./public/

ENV NODE_ENV=production
ENV PORT=18820

EXPOSE 18820

CMD ["node", "server.js"]
