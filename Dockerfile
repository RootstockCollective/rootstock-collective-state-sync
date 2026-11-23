# Stage 1: Build
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
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
