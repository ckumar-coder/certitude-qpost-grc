#!/usr/bin/env bash
#
# verify-qpost-permissions.sh -- run the permissions-engine regression check
# (test-permissions-seed.js) against certitude-qpost's live database.
#
# Run this after:
#   1. PROJECT_ID=certitude-qpost bash deploy/deploy-qpost-prod.sh
#   2. PROJECT_ID=certitude-qpost bash deploy/migrate-qpost-prod.sh schema
#
# Usage:
#   PROJECT_ID=certitude-qpost bash deploy/verify-qpost-permissions.sh

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID=certitude-qpost}"

export REGION=me-central1
export SERVICE_NAME=qpost-app
export INSTANCE_NAME=qpost-db

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================================"
echo "  Qatar Post — Permissions Engine Regression Check"
echo "  Project: ${PROJECT_ID}"
echo "========================================================"

"$SCRIPT_DIR/verify-permissions-seed.sh"
