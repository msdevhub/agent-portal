# Agent Portal v2 — Pixel Style Project Dashboard

## What to Build

A **pixel-art style research project management dashboard** (like Star Office UI / Minecraft block aesthetic).

## Tech Stack

- **Frontend**: Pure HTML + CSS + JavaScript (NO frameworks, NO React, NO Next.js)
- **Backend**: Tiny Node.js Express server (serves static files + proxies Supabase API calls to hide the service key)
- **Database**: Supabase PostgreSQL via `/pg/query` endpoint
- **Port**: 18820

## Supabase Connection

```
URL: https://db.dora.restry.cn
Service Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q
```

Query format: POST to `${URL}/pg/query` with body `{ "query": "SELECT ..." }` and headers `apikey` + `Authorization: Bearer ...`.

## Database Schema

Create these tables (prefix `AP_`):

### AP_projects
```sql
CREATE TABLE IF NOT EXISTS "AP_projects" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  stage TEXT DEFAULT 'question',  -- question, literature, hypothesis, poc, conclusion, report
  status TEXT DEFAULT 'active',   -- active, completed, paused, archived
  emoji TEXT DEFAULT '🔬',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### AP_tasks
```sql
CREATE TABLE IF NOT EXISTS "AP_tasks" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL,  -- question, literature, hypothesis, poc, conclusion, report
  status TEXT DEFAULT 'pending',  -- pending, in_progress, done, blocked
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### AP_notes
```sql
CREATE TABLE IF NOT EXISTS "AP_notes" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'finding',  -- finding, decision, blocker, idea
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Visual Design — Pixel Art Style

**IMPORTANT**: This is the core design requirement. Everything should feel like a cozy pixel game.

### Color Palette
- Background: Dark navy/space blue (#1a1a2e, #16213e)
- Cards: Warm pixel blocks with visible borders, slightly rounded
- Accent: Pixel-style green (#50fa7b), pixel yellow (#f1fa8c), pixel pink (#ff79c6)
- Text: Light cream/white on dark backgrounds
- Use CSS `image-rendering: pixelated` where applicable

### Typography
- Use a pixel font (embed "Press Start 2P" from Google Fonts, or "VT323")
- Body text: VT323 (more readable), Headers: Press Start 2P (more pixel-y)

### UI Components (all pixel-styled)

1. **Header Bar**: Pixel-art banner with title "🔬 Ottor's Research Lab" and stats blocks
2. **Project Cards**: Block-shaped cards with:
   - Pixel border (4px solid, slightly 3D raised effect using box-shadow)
   - Stage indicator as a pixel progress bar (6 blocks for 6 stages, filled = completed)
   - Status badge (pixel-styled label)
   - Task count display
3. **Stage Progress Visualization**: 
   - 6 blocks in a row: 提问 → 文献 → 假设 → POC → 结论 → 报告
   - Current stage glows/pulses
   - Completed stages are filled solid
   - Future stages are dim/outline only
4. **Task List**: Inside each project detail view
   - Checkbox-style pixel toggles
   - Color-coded by status (pending=gray, in_progress=yellow pulse, done=green, blocked=red)
5. **Stats Dashboard**: Top area showing:
   - Total projects (pixel counter style)
   - Active / Completed counts
   - Maybe a tiny pixel character (Ottor mascot) that's animated

### Animations
- Subtle CSS animations: pulsing current-stage blocks, hover effects on cards
- Maybe a blinking cursor effect on the header
- Card hover: slight "lift" with pixel shadow change

### Layout
- Dark background with subtle pixel grid pattern
- Responsive: works on desktop and mobile
- Single page app with sections:
  - Dashboard (all projects overview)
  - Project detail (click a card → expand or navigate)

## Server Structure

```
server.js          — Express server (port 18820)
public/
  index.html       — Main HTML page
  style.css        — All pixel styles  
  app.js           — Frontend JavaScript (fetch API, DOM manipulation)
  fonts/           — (optional, can use Google Fonts CDN)
package.json       — Express dependency only
```

## API Routes (server.js)

```
GET  /api/projects         — List all projects
GET  /api/projects/:slug   — Get project with tasks and notes
POST /api/projects         — Create project
PUT  /api/projects/:id     — Update project
POST /api/tasks            — Create task
PUT  /api/tasks/:id        — Update task (status change)
DELETE /api/tasks/:id      — Delete task
POST /api/notes            — Create note
GET  /api/stats            — Dashboard stats
POST /api/init-db          — Create tables if not exist
```

All API routes proxy SQL to Supabase `/pg/query`.

## Important Notes

1. **No frameworks** — vanilla HTML/CSS/JS only
2. **Pixel aesthetic is mandatory** — this is the whole point
3. The server must start on port 18820
4. Create a `start.sh` script that does `npm install && node server.js`
5. SQL queries should use parameterized-style escaping (escape single quotes)
6. The init-db endpoint should be safe to call multiple times (IF NOT EXISTS)
7. Language: UI text in Chinese (中文)

When completely finished, run this command to notify me:
openclaw system event --text "Done: Agent Portal v2 pixel-style dashboard built — server.js + public/ with full CRUD" --mode now
