# CHANGELOG.md

## [Unreleased] — Nexora Platform Adaptation (2026-04-02)

### Added
- **Settings Panel**: Right-side drawer with default bot selector (`/api/portal-settings`)
- **Database**: `AP_portal_settings` table for frontend configuration
- **Database**: `AP_bots.status` column (`active`/`disabled`)
- **API**: `GET/PUT /api/portal-settings` — persistent portal configuration
- **API**: `GET /api/portal-config` — read-only portal metadata
- **API**: `/api/bots/status` now returns `bot_status` from DB + live `online_status`
- **API**: `/api/ops/messages` injects `is_self` field for human/bot identification
- **API**: `/api/dashboard` `updated_at` sourced from all data tables (not just server snapshots)
- **Deploy**: `app/deploy.sh` — automated deployment script
- **Deploy**: `app/migrations/001_nexora_adaptation.sql` — DB migration for Nexora changes
- **Chat**: Discord-style message layout (avatar + name + timestamp header, full-width content)
- **Chat**: Table styling with borders, header background, hover highlight
- **Chat**: Mobile tab swipe to switch between Kanban/Bots/Servers
- **Chat**: Auto-focus input on "start chat" click
- **Pipeline**: `digest.py` loads projects from PG directly (removes Supabase REST dependency)
- **Pipeline**: `project_insights.py` auto-INSERT when project not found in DB
- **Pipeline**: `notifier.py` portal URL configurable
- **Pipeline**: `push/db.py` — new PG direct database module

### Changed
- **Chat**: Removed bubble-style messages, now uses Discord-style flat layout
- **Chat**: Font size reduced to 13px for consistency
- **Chat**: Window title matches selected default bot (no longer hardcoded "Ottor")
- **Chat**: Removed top border-radius on chat panel (all screen sizes)
- **Chat**: `PORTAL_SENDER_USER_ID` configurable (was hardcoded)
- **Default bot**: Changed from Ottor to Nexora
- **Bot fleet**: Disabled bots collapsed to bottom with toggle
- **Pipeline**: Timestamp format fix (`+00:00Z` → proper ISO 8601)
- **Config**: All Mattermost/DB connections use environment variables with fallbacks

### Fixed
- `AP_projects` missing `metadata`, `tags` columns causing 500 on `/api/ap-projects`
- Pipeline project updates failing (UPDATE on non-existent rows)
- Pipeline Supabase REST 502 fallback causing ID mismatch
- Chat history showing all messages as "Bot" (missing human user ID)
- `package.json` `"type": "module"` conflict with PM2 ecosystem config

### Environment Variables

#### Backend (server.cjs)
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PORT` | No | Listen port (default: 3002) |
| `MM_BASE_URL` | No | Mattermost URL |
| `MM_ADMIN_TOKEN` | No | Mattermost admin token |

#### Digest Pipeline (digest/.env)
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `MM_BASE_URL` | ✅ | Mattermost URL |
| `MM_ADMIN_TOKEN` | ✅ | Mattermost admin token |
| `DADDY_USER_ID` | ✅ | Human user's Mattermost user ID |
| `L1_API_KEY` | ✅ | Azure OpenAI API key |
| `L1_BASE_URL` | No | Azure OpenAI endpoint |
| `L1_MODEL` | No | L1 extraction model (default: gpt-4.1) |
| `L3_MODEL` | No | L3 insights model (default: gpt-5.4) |

### Database Migrations
After running `schema.sql`, apply migration:
```bash
psql $DATABASE_URL -f app/migrations/001_nexora_adaptation.sql
```

Or via API:
```bash
curl -X POST http://localhost:$PORT/api/init-db
```
