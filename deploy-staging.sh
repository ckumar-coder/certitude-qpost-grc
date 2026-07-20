#!/usr/bin/env bash
#
# deploy-staging.sh — build and deploy GRC Workstation to the staging environment.
#
# Run this from the repo root whenever you want to push the current codebase
# to staging for testing before a production deploy.
#
# Prerequisites:
#   - setup-staging.sh has been run at least once (staging Cloud SQL + secrets exist)
#   - gcloud CLI installed and authenticated
#
# Usage:
#   cd /path/to/grc-app
#   ./deploy-staging.sh
#
# To run the full test suite against staging after deploy:
#   BASE_URL=<staging-url> \
#   ADMIN_EMAIL=c.kumar@certitude-advisory.ca \
#   ADMIN_PASSWORD=<password> \
#   TEST_API_KEY=<staging-test-api-key> \
#   node test-suite.js
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT_ID=certitude-grc
REGION=northamerica-northeast1
SERVICE_NAME=grc-app-staging
AR_REPO=grc-images
STAGING_INSTANCE=certitude-grc-db-staging
SA_EMAIL=grc-app-run@${PROJECT_ID}.iam.gserviceaccount.com

IMAGE_TAG=$(date +%Y%m%d-%H%M%S)
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe "${STAGING_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --format='value(connectionName)')

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   GRC Workstation — Staging Deploy                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Image:   ${IMAGE}"
echo "  Service: ${SERVICE_NAME}"
echo ""

# ── Generate release log doc ───────────────────────────────────────────────────
echo "== Regenerating GRC_App_Release_Log.docx =="
node scripts/generate-release-log.js

# ── Build and push image ───────────────────────────────────────────────────────
echo "== Building and pushing ${IMAGE} =="
gcloud builds submit \
    --project="${PROJECT_ID}" \
    --tag="${IMAGE}" \
    .

# ── Deploy Cloud Run staging service ──────────────────────────────────────────
echo ""
echo "== Deploying Cloud Run service: ${SERVICE_NAME} =="
gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --service-account="${SA_EMAIL}" \
    --set-cloudsql-instances="${INSTANCE_CONNECTION_NAME}" \
    --set-secrets="\
DATABASE_URL=grc-app-staging-database-url:latest,\
EMAIL_ENCRYPTION_KEY=grc-app-staging-email-encryption-key:latest,\
TEST_API_KEY=grc-app-staging-test-api-key:latest,\
APP_URL=grc-app-staging-url:latest" \
    --set-env-vars="SESSION_TIMEOUT_MINUTES=10,LOCKOUT_MINUTES=30,PASSWORD_MAX_AGE_DAYS=90,NODE_ENV=staging" \
    --min-instances=0 \
    --max-instances=2 \
    --memory=512Mi \
    --cpu=1 \
    --allow-unauthenticated

# ── Run schema migrations on staging ──────────────────────────────────────────
echo ""
echo "== Applying schema migrations on staging =="
gcloud run jobs deploy "${SERVICE_NAME}-migrate" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --command=node \
    --args=migrate-all.js \
    --set-secrets="DATABASE_URL=grc-app-staging-database-url:latest" \
    --set-cloudsql-instances="${INSTANCE_CONNECTION_NAME}" \
    --service-account="${SA_EMAIL}" \
    --max-retries=0

gcloud run jobs execute "${SERVICE_NAME}-migrate" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --wait

# ── Seed staging tenant (idempotent) ──────────────────────────────────────────
echo ""
echo "== Seeding staging tenant (company + admin user) =="
gcloud run jobs deploy "${SERVICE_NAME}-seed" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --command=node \
    --args=seed-staging.js \
    --set-secrets="DATABASE_URL=grc-app-staging-database-url:latest,ADMIN_PASSWORD=grc-app-staging-admin-password:latest" \
    --set-cloudsql-instances="${INSTANCE_CONNECTION_NAME}" \
    --service-account="${SA_EMAIL}" \
    --set-env-vars="COMPANY_NAME=Certitude Advisory,COMPANY_CODE=CERT,ADMIN_EMAIL=c.kumar@certitude-advisory.ca,ADMIN_FULL_NAME=Chandrashekar Kumar" \
    --max-retries=0

gcloud run jobs execute "${SERVICE_NAME}-seed" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --wait

# ── Print result ───────────────────────────────────────────────────────────────
URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format='value(status.url)')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   Staging deploy complete                                 ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  URL:          ${URL}"
echo "  Health check: ${URL}/api/health"
echo ""
echo "  To run the full test suite against staging:"
echo "  (retrieve TEST_API_KEY from Secret Manager: grc-app-staging-test-api-key)"
echo ""
echo "    BASE_URL=${URL} \\"
echo "    ADMIN_EMAIL=c.kumar@certitude-advisory.ca \\"
echo "    ADMIN_PASSWORD=<your-admin-password> \\"
echo "    TEST_API_KEY=<grc-app-staging-test-api-key> \\"
echo "    node test-suite.js"
echo ""
echo "  If all tests pass, deploy to production with:"
echo "    ./deploy-certitude.sh"
echo ""
