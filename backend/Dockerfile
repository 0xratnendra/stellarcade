FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY knexfile.js ./

EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && exec node src/server.js"]
