# Architecture

## Pipeline Flow

```
                          ┌──────────────────────────────┐
                          │  Mattermost Server (Admin API)│
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  L0: collector.py             │
                          │  • get_all_bot_users()        │
                          │  • get_dm_channel(bot)        │
                          │  • get_posts_since(cursor)    │
                          │  • filter_posts()             │
                          │  • format_posts_for_llm()     │
                          │  Output: formatted transcript  │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  L1: extractor.py             │
                          │  Model: gpt-4.1               │
                          │  • Auto-chunks long convos    │
                          │  • Extracts structured events │
                          │  • Tracks deliverables, flags │
                          │  Output: {events, flags}      │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  L1.5: aggregator.py          │
                          │  Model: gpt-4.1               │
                          │  • Merges events → tasks      │
                          │  • 3-12 tasks per bot         │
                          │  Output: {tasks}              │
                          └──────────────┬───────────────┘
                                         │
                    ┌────────────────────┬┘
                    │                    │
     ┌──────────────▼──────────┐  ┌─────▼────────────────────┐
     │ project_tracker.py      │  │ project_insights.py       │
     │ • Incremental matching  │  │ • LLM match tasks→projects│
     │ • New project discovery │  │ • Generate health status  │
     │ • Dormant detection     │  │ • Push status to Supabase │
     │ • Local cache sync      │  │ • 30-min cooldown lock    │
     └──────────────┬──────────┘  └─────┬────────────────────┘
                    │                    │
                    └────────┬───────────┘
                             │
              ┌──────────────▼───────────────┐
              │  push/pusher.py               │
              │  • push_activities() → AP_daily_activities │
              │  • push_timeline()  → AP_daily_timeline   │
              │  • sync_bots()      → AP_bots              │
              └──────────────┬───────────────┘
                             │
              ┌──────────────▼───────────────┐
              │  push/notifier.py             │
              │  • Project board summary      │
              │  • 🔴 blocked / 🟡 attention   │
              │  • 🟢 healthy / ⚪ stale        │
              │  → Daddy's Mattermost DM      │
              └──────────────────────────────┘
```

## Data Flow

```
MM API → raw/{date}/{bot}.json (backup)
       → _l1_results.json (L1 output)
       → _aggregated_tasks.json (L1.5 output)
       → _cursor.json (incremental state)
       → _projects_cache.json (project tracking state)

Supabase:
  AP_projects.metadata  ← project health, summary, next_action
  AP_daily_activities   ← aggregated tasks per bot per day
  AP_daily_timeline     ← key events per bot per day
  AP_bots               ← bot registry sync
```

## Incremental Collection

The collector maintains a per-bot cursor (`_cursor.json`) tracking the
`create_at` timestamp of the last collected message. Subsequent runs only
fetch messages newer than the cursor, merge with cached data, and deduplicate
by post ID. Use `--full` to bypass and re-collect everything.

## Cooldown Lock

`project_insights.py` uses a `.push_lock` file to prevent duplicate
notifications within 30 minutes. The lock file stores a UNIX timestamp;
if less than 1800 seconds have elapsed, the notification step is skipped
(but Supabase writes still proceed).
