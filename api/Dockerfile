# API-Image (Node.js LTS). Installiert auch devDependencies, damit die Tests im Container laufen
# (docker compose exec api npm test); eine getrennte Produktionsstufe ist Härtung für Iteration 5.
FROM node:26-alpine
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY src/ ./src/
COPY test/ ./test/
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
