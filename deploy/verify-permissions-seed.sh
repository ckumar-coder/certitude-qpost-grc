#!/usr/bin/env bash
#
# verify-permissions-seed.sh -- run test-permissions-seed.js against a
# client's Cloud SQL instance, as a one-off Cloud Run Job built from the
# same image as the running service. Mirrors migrate.sh's mechanics exactly
# (same Cloud SQL connection + DATABASE_URL secret plumbing) so it works
# from a local Mac without needing a Cloud SQL Auth Proxy set up.
#
# Run this after migrate.sh (schema mode) has applied
# schema_v75_permissions_engine.sql, to confirm the seed landed exactly as
# decided in RBAC_Permissions_Engine_Scoping.docx Section 11 before trusting
# it in production.
#
# Usage:
#   PROJECT_ID=acme-grc REGION=me-central1 SERVICE_NAME=acme-grc \
#   INSTANCE_NAME=acme-grc-db \
#   ./verify-permissions-seed.sh

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${REGION:=me-central1}"
: "${INSTANCE_NAME:?Set INSTANCE_NAME}"
: "${SERVICE_NAME:?Set SERVICE_NAME}"

INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe "$INSTANCE_NAME" --project="$PROJECT_ID" --format='value(connectionName)')
SA_EMAIL="${SERVICE_NAME}-run@${PROJECT_ID}.iam.gserviceaccount.com"
JOB_NAME="${SERVICE_NAME}-verify-permissions"

# Reuse the image currently deployed to the Cloud Run service, so the check
# always runs against the same code that's actually live.
IMAGE=$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format='value(spec.template.spec.containers[0].image)')

echo "== Creating/updating verification job: ${JOB_NAME} =="
gcloud run jobs deploy "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$IMAGE" \
    --service-account="$SA_EMAIL" \
    --set-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
    --set-secrets="DATABASE_URL=${SERVICE_NAME}-database-url:latest" \
    --command=node \
    --args="test-permissions-seed.js" \
    --max-retries=0

echo "== Executing ${JOB_NAME} =="
gcloud run jobs execute "$JOB_NAME" --project="$PROJECT_ID" --region="$REGION" --wait

cat <<EOF

============================================================
✔ Verification job '${JOB_NAME}' finished running.

View the pass/fail results:
  gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=${JOB_NAME}" \\
    --project=${PROJECT_ID} --limit=200 --format='value(textPayload)'

Look for the final line: "N/N checks passed". If the job's exit code was
non-zero, "gcloud run jobs execute ... --wait" above will itself have
returned a non-zero exit code and printed an error -- any regression
failures are real, not a connectivity issue.
============================================================
EOF
