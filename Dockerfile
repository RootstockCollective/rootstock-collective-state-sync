# Stage 1: Build
FROM node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config/

# Download AWS RDS CA certificate
RUN node -e "\
  fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then(async (res) => { \
    if (!res.ok) throw new Error('Failed to download RDS CA bundle: HTTP ' + res.status); \
    const pem = await res.text(); \
    if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('RDS CA bundle is not a PEM file'); \
    require('fs').writeFileSync('rds-ca-cert.pem', pem); \
  })"

RUN npm ci --omit=dev

CMD ["node", "dist/app/main.js"]
