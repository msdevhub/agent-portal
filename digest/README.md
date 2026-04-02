# Agent Portal Digest

Automated project status tracking pipeline for the [Agent Portal](https://portal.dev.dora.restry.cn).

Collects Mattermost chat logs from all bot DMs, extracts structured events via LLM, matches them to tracked projects, and pushes status updates to Supabase — giving Daddy a live project board without manual updates.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  L0: Collect │────▶│ L1: Extract │────▶│ L1.5: Agg.   │────▶│ L3: Insights │
│  (MM API)    │     │  (gpt-4.1)  │     │  (gpt-4.1)   │     │  (gpt-5.4)   │
└─────────────┘     └─────────────┘     └──────────────┘     └──────┬───────┘
                                                                     │
                    ┌──────────────┐     ┌──────────────┐           │
                    │ Notify Daddy │◀────│ Push to      │◀──────────┘
                    │ (MM DM)      │     │ Supabase     │
                    └──────────────┘     └──────────────┘
```

| Stage | Module | Model | What it does |
|-------|--------|-------|-------------|
| L0 | `pipeline/collector.py` | — | Pull Daddy↔bot DMs from MM API (incremental) |
| L1 | `pipeline/extractor.py` | gpt-4.1 | Extract every event as structured JSON |
| L1.5 | `pipeline/aggregator.py` | gpt-4.1 | Merge events into 5–10 tasks per bot |
| Match | `pipeline/project_tracker.py` | gpt-4.1 | Map tasks → projects, discover new ones |
| L3 | `pipeline/project_insights.py` | gpt-5.4 | Project health analysis with history |
| Push | `push/pusher.py` | — | Write to Supabase tables |
| Notify | `push/notifier.py` | — | Send board summary to Daddy's DM |

## Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — fill in MM_ADMIN_TOKEN, SUPABASE_SERVICE_KEY, L1_API_KEY

# 2. Run once
python3 digest.py

# 3. Options
python3 digest.py --date 2026-04-01   # specific date
python3 digest.py --dry-run            # analyse without pushing
python3 digest.py --l1-only            # L0+L1 extraction only
python3 digest.py --full               # ignore cursor, full re-collect

# 4. Install cron (every 30 min, 09:00–23:59 CST)
bash scripts/setup_cron.sh

# 5. HTTP trigger (for portal's Refresh button)
python3 server/trigger.py              # listens on :18790
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `AP_projects` | Project registry (name, status, metadata, health) |
| `AP_daily_activities` | Per-bot aggregated tasks by date |
| `AP_daily_timeline` | Per-bot key events by date |
| `AP_bots` | Bot registry (agent_id ↔ MM username mapping) |
| `AP_daily_reports` | Per-bot daily reports (v3, currently unused) |
| `AP_daily_insights` | Global daily insights (v3, currently unused) |

## Project Structure

```
agent-portal-digest/
├── digest.py                    # Main entry point
├── config.py                    # Env-based configuration
├── pipeline/
│   ├── collector.py             # L0: MM data collection
│   ├── extractor.py             # L1: LLM event extraction
│   ├── aggregator.py            # L1.5: Task aggregation
│   ├── project_tracker.py       # Project discovery + matching
│   ├── project_insights.py      # L3: Project status analysis
│   └── llm.py                   # Shared LLM call + JSON parse
├── push/
│   ├── supabase.py              # Supabase REST client + ID mapping
│   ├── pusher.py                # Push activities/timeline/projects/bots
│   └── notifier.py              # Mattermost notification to Daddy
├── server/
│   └── trigger.py               # HTTP trigger server (:18790)
├── scripts/
│   ├── run_daily.sh             # Cron: full pipeline
│   ├── run_l0.sh                # Cron: L0+L1 only
│   └── setup_cron.sh            # Install crontab
├── data/                        # Runtime data (gitignored)
│   └── raw/{date}/              # Per-date backups + L1 results
├── docs/
│   └── ARCHITECTURE.md          # Detailed pipeline flow
├── .env.example
├── .gitignore
└── README.md
```

## Environment Variables

See [.env.example](.env.example) for the full list.

Required:
- `MM_ADMIN_TOKEN` — Mattermost admin token
- `SUPABASE_SERVICE_KEY` — Supabase service role JWT
- `L1_API_KEY` — Azure OpenAI API key

Optional (sensible defaults):
- `MM_BASE_URL`, `SUPABASE_URL`, `L1_BASE_URL` — service endpoints
- `L1_MODEL`, `L3_MODEL` — model names
- `DIGEST_DATA_DIR` — where to store raw data (default: `./data`)
- `TRIGGER_PORT` — HTTP trigger port (default: `18790`)
