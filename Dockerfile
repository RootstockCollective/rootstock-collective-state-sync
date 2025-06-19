# Stage 1: Build
FROM node:22-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config/

# Download AWS RDS CA certificate
RUN apk add --no-cache wget && \
    wget -O rds-ca-cert.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

RUN npm install --omit=dev

CMD ["node", "dist/app/main.js"]
