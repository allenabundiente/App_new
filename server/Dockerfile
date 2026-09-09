FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY schema.sql ./schema.sql

FROM runtime AS migrate
CMD ["node", "dist/entries/migrate.js"]

FROM runtime AS auth
ENV PORT=4001
EXPOSE 4001
CMD ["node", "dist/entries/auth.js"]
FROM runtime AS core
ENV PORT=4002
EXPOSE 4002
CMD ["node", "dist/entries/core.js"]

FROM runtime AS engagement
ENV PORT=4003
EXPOSE 4003
CMD ["node", "dist/entries/engagement.js"]
