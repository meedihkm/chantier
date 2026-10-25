FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=3541
VOLUME /data
EXPOSE 3541
CMD ["node", "server.js"]
