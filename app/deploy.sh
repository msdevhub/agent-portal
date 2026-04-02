#!/bin/bash
# ============================================================
# Agent Portal — Nexora Platform Deployment Script
# 
# Deploys the full application on a server with:
#   - Node.js >= 18
#   - PM2 (npm i -g pm2)
#   - PostgreSQL (Docker or native)
#   - Python >= 3.10 (for digest pipeline)
#   - Caddy (reverse proxy)
#
# Usage:
#   bash deploy.sh                    # Full deploy
#   bash deploy.sh --skip-db          # Skip DB init (already done)
#   bash deploy.sh --skip-pipeline    # Skip digest pipeline setup
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/mvp-apps/agent-portal}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Parse args
SKIP_DB=false
SKIP_PIPELINE=false
for arg in "$@"; do
  case $arg in
    --skip-db) SKIP_DB=true ;;
    --skip-pipeline) SKIP_PIPELINE=true ;;
  esac
done

# ── 1. Check prerequisites ──
log "Checking prerequisites..."
command -v node >/dev/null || err "Node.js not found"
command -v pm2 >/dev/null || err "PM2 not found (npm i -g pm2)"
command -v python3 >/dev/null || warn "Python3 not found (digest pipeline won't work)"
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -ge 18 ] || err "Node.js >= 18 required (got v$NODE_VER)"
log "  Node $(node -v) ✓  PM2 $(pm2 -v 2>/dev/null) ✓"

# ── 2. Install dependencies & build frontend ──
log "Installing dependencies..."
cd "$APP_DIR"
npm install --production=false 2>&1 | tail -3

log "Building frontend..."
npm run build 2>&1 | tail -3

# ── 3. Prepare deploy directory ──
log "Deploying to $DEPLOY_DIR..."
mkdir -p "$DEPLOY_DIR/dist"

# Copy server + built frontend
cp server.cjs "$DEPLOY_DIR/server.js"
cp package.json "$DEPLOY_DIR/package.json"
cp schema.sql "$DEPLOY_DIR/schema.sql" 2>/dev/null || true
cp -r migrations "$DEPLOY_DIR/migrations" 2>/dev/null || true

# Remove "type": "module" for PM2 compat
python3 -c "
import json
with open('$DEPLOY_DIR/package.json') as f: d = json.load(f)
d.pop('type', None)
with open('$DEPLOY_DIR/package.json', 'w') as f: json.dump(d, f, indent=2)
" 2>/dev/null || true

# Copy frontend build
rm -rf "$DEPLOY_DIR/dist"
cp -r dist "$DEPLOY_DIR/dist"

# Install production deps
cd "$DEPLOY_DIR"
npm install --production 2>&1 | tail -3

# ── 4. Database ──
if [ "$SKIP_DB" = false ]; then
  log "Initializing database..."
  
  if [ -z "${DATABASE_URL:-}" ]; then
    warn "DATABASE_URL not set — skipping DB init"
    warn "Set DATABASE_URL and run: curl -X POST http://localhost:\$PORT/api/init-db"
  else
    log "  DATABASE_URL is set, will init via API after server starts"
  fi
fi

# ── 5. PM2 ecosystem config ──
PORT="${PORT:-4000}"
cat > "$DEPLOY_DIR/ecosystem.config.js" << PMEOF
module.exports = {
  apps: [{
    name: "agent-portal",
    script: "server.js",
    cwd: "$DEPLOY_DIR",
    interpreter: "node",
    autorestart: true,
    max_restarts: 10,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    env: {
      PORT: "$PORT",
      DATABASE_URL: "${DATABASE_URL:-}",
      MM_BASE_URL: "${MM_BASE_URL:-}",
      MM_ADMIN_TOKEN: "${MM_ADMIN_TOKEN:-}",
      NODE_ENV: "production"
    }
  }]
};
PMEOF

# ── 6. Start/restart PM2 ──
log "Starting agent-portal on port $PORT..."
pm2 delete agent-portal 2>/dev/null || true
pm2 start "$DEPLOY_DIR/ecosystem.config.js"
sleep 3

# ── 7. Init DB via API ──
if [ "$SKIP_DB" = false ] && [ -n "${DATABASE_URL:-}" ]; then
  log "Running init-db..."
  INIT_RESULT=$(curl -s -X POST "http://localhost:$PORT/api/init-db" 2>/dev/null)
  echo "  $INIT_RESULT"
  
  # Run migrations
  if [ -f "$DEPLOY_DIR/migrations/001_nexora_adaptation.sql" ]; then
    log "Running migrations..."
    # Extract PG connection from DATABASE_URL
    if command -v psql >/dev/null; then
      psql "$DATABASE_URL" -f "$DEPLOY_DIR/migrations/001_nexora_adaptation.sql" 2>&1 | tail -5
    else
      warn "psql not available — run migrations manually"
    fi
  fi
fi

# ── 8. Digest pipeline ──
if [ "$SKIP_PIPELINE" = false ] && command -v python3 >/dev/null; then
  DIGEST_DIR="$(dirname "$APP_DIR")/digest"
  if [ -d "$DIGEST_DIR" ]; then
    log "Setting up digest pipeline..."
    cd "$DIGEST_DIR"
    if [ ! -d ".venv" ]; then
      python3 -m venv .venv
    fi
    .venv/bin/pip install -q openai psycopg2-binary requests python-dotenv 2>&1 | tail -3
    
    if [ ! -f ".env" ]; then
      warn "digest/.env not found — copy from .env.example and configure"
    else
      log "  Digest pipeline ready"
    fi
  fi
fi

# ── 9. Verify ──
log "Verifying..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
  log "✅ Agent Portal running on http://localhost:$PORT (HTTP $HTTP_CODE)"
else
  warn "HTTP $HTTP_CODE — check logs: pm2 logs agent-portal"
fi

echo ""
log "═══════════════════════════════════════"
log " Deployment complete!"
log " URL: http://localhost:$PORT"
log " Logs: pm2 logs agent-portal"
log " Status: pm2 list"
log "═══════════════════════════════════════"
