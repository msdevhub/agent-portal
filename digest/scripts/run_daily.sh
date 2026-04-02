#!/bin/bash
# run_daily.sh — Full pipeline (L0 → L1 → L1.5 → L3 → push)
# Called by cron every 30 min during 09:00–23:59 CST.

set -e
cd "$(dirname "$0")/.."

# Load env if present
[ -f .env ] && set -a && source .env && set +a

exec python3 digest.py "$@"
