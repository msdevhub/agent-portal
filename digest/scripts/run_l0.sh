#!/bin/bash
# run_l0.sh — L0 + L1 extraction only (no project matching or push)
# Called by cron for lightweight incremental collection.

set -e
cd "$(dirname "$0")/.."

# Load env if present
[ -f .env ] && set -a && source .env && set +a

exec python3 digest.py --l1-only "$@"
