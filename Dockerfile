# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /usr/src/app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
# Builds straight into ../public (see frontend/vite.config.js)
RUN npm run build

# ---- Stage 2: install backend deps ----
FROM node:20-alpine AS backend-build
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /usr/src/app

# Run as a non-root user inside the container
RUN addgroup -S app && adduser -S app -G app

COPY --from=backend-build --chown=app:app /usr/src/app/node_modules ./node_modules
COPY --chown=app:app package*.json ./
COPY --chown=app:app server.js auth.js db.js csv.js email.js validate.js fileScan.js seed-controls-data.js activate-test-user.js disable-mfa-test-user.js ./
COPY --chown=app:app schema_v*.sql ./
COPY --chown=app:app migrate-all.js bootstrap-tenant.js seed-staging.js ./
COPY --chown=app:app migrate-v1-to-v2.js migrate-v2-to-v3.js migrate-v3-to-v4.js migrate-v4-to-v5.js migrate-v5-to-v6.js migrate-v6-to-v7.js migrate-v7-to-v8.js migrate-v8-to-v9.js migrate-v9-to-v10.js migrate-v10-to-v11.js migrate-v11-to-v12.js migrate-v12-to-v13.js migrate-v13-to-v14.js migrate-v14-to-v15.js migrate-v16-to-v17.js migrate-v17-to-v18.js migrate-v33-to-v34.js migrate-v35-to-v36.js migrate-v36-to-v37.js migrate-v37-to-v38.js migrate-v38-to-v39.js ./
COPY --chown=app:app --from=frontend-build /usr/src/app/public ./public

USER app
EXPOSE 8080
ENV NODE_ENV=production

CMD [ "node", "server.js" ]
