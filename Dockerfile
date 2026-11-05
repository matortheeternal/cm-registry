FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "src/server.js"]
