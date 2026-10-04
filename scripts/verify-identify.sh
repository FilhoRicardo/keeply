#!/usr/bin/env bash
# Sends one label photo to a running Keeply server's /api/identify and prints the proposal.
# The AI key lives only in the server's environment. Usage: scripts/verify-identify.sh photo.jpg [base-url]
set -euo pipefail
PHOTO=${1:?usage: scripts/verify-identify.sh photo.jpg [base-url]}
BASE=${2:-http://localhost:3000}
case "${PHOTO,,}" in *.png) TYPE=image/png ;; *.webp) TYPE=image/webp ;; *) TYPE=image/jpeg ;; esac
curl -sS -X POST "$BASE/api/identify" -F "photo=@${PHOTO};type=${TYPE}" | (command -v jq >/dev/null && jq . || cat)
echo
