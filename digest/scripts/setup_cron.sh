#!/bin/bash
# setup_cron.sh — Install crontab entries for the digest pipeline.
#
# Run once after deployment:  bash scripts/setup_cron.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CRON_FULL="*/30 9-23 * * * ${PROJECT_DIR}/scripts/run_daily.sh >> ${PROJECT_DIR}/data/cron.log 2>&1"
CRON_L0="*/15 9-23 * * * ${PROJECT_DIR}/scripts/run_l0.sh >> ${PROJECT_DIR}/data/cron_l0.log 2>&1"

# Remove old entries (from either old or new paths)
(crontab -l 2>/dev/null | grep -v 'mm-daily-digest' | grep -v 'agent-portal-digest') | crontab -

# Add new entries
(crontab -l 2>/dev/null; echo ""; echo "# === Agent Portal Digest ==="; echo "$CRON_FULL"; echo "$CRON_L0") | crontab -

echo "✅ Crontab updated. Current entries:"
crontab -l | grep -A2 'Portal Digest'
