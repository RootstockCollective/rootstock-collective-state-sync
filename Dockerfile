# Stage 1: Build
FROM node:25-alpine@sha256:809972647175c30a4c7763d3e6cc064dec588972af57e540e5a6f27442bb0845 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:25-alpine@sha256:809972647175c30a4c7763d3e6cc064dec588972af57e540e5a6f27442bb0845
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config/

# Download AWS RDS CA certificate
RUN apk add --no-cache wget && \
    wget -O rds-ca-cert.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

RUN npm install --omit=dev

CMD ["node", "dist/app/main.js"]
