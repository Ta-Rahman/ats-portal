# Stufe 1: SPA mit Vite bauen. Stufe 2: statische Dateien mit nginx ausliefern (+ Proxy für /api).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ ./src/
# Schrift, Logo und Favicon (Iteration 6): Vite kopiert public/ unverändert nach dist/.
COPY public/ ./public/
RUN npm run build

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
