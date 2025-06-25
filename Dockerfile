# Stage 1: Build
FROM node:24-alpine@sha256:7aaba6b13a55a1d78411a1162c1994428ed039c6bbef7b1d9859c25ada1d7cc5 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:24-alpine@sha256:7aaba6b13a55a1d78411a1162c1994428ed039c6bbef7b1d9859c25ada1d7cc5
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config/

# Download AWS RDS CA certificate
RUN apk add --no-cache wget && \
    wget -O rds-ca-cert.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

RUN npm install --omit=dev

CMD ["node", "dist/app/main.js"]
