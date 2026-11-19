FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY test ./test
USER node
EXPOSE 8000
CMD ["node", "src/server.js"]
