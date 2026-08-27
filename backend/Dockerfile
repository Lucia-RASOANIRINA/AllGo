# --- Étape de compilation ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Étape d'exécution ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S allgo && adduser -S allgo -G allgo
COPY --from=build --chown=allgo:allgo /app/node_modules ./node_modules
COPY --from=build --chown=allgo:allgo /app/dist ./dist
COPY --from=build --chown=allgo:allgo /app/package.json ./package.json
USER allgo
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
