# Imagen para publicar FeriaPlace en un hosting con Docker (Railway, Render, etc.).
# Al arrancar crea las tablas si faltan (npm run instalar) y luego levanta el servidor.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json backend/
RUN npm --prefix backend ci --omit=dev

COPY backend/src backend/src
COPY database database
COPY public public

EXPOSE 4000
CMD ["sh", "-c", "node backend/src/instalar.js && node backend/src/index.js"]
