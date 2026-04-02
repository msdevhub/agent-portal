-- ============================================================
-- Agent Portal — Database Schema Initialization
-- Run once on a fresh PostgreSQL database to create all tables.
-- All tables use the AP_ prefix. Total: 16 tables.
--
-- Usage:
--   psql -h localhost -U agent_portal -d postgres -f schema.sql
--   OR call POST /api/init-db on the running server
--
-- Prerequisites (for Supabase-hosted PG):
--   As superuser/supabase_admin:
--     GRANT CREATE, USAGE ON SCHEMA public TO agent_portal;
--     -- If tables were created by supabase_admin, transfer ownership:
--     ALTER TABLE "AP_xxx" OWNER TO agent_portal;
--     -- Disable RLS on AP_ tables if needed:
--     ALTER TABLE "AP_xxx" DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ============================================================
-- 1. Core project management tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "AP_projects" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  stage TEXT DEFAULT 'question',
  status TEXT DEFAULT 'active',
  emoji TEXT DEFAULT '🔬',
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  agent_id TEXT DEFAULT 'ottor',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AP_tasks" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AP_tasks_project_id_idx" ON "AP_tasks"(project_id);

CREATE TABLE IF NOT EXISTS "AP_notes" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'finding',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AP_notes_project_id_idx" ON "AP_notes"(project_id);

CREATE TABLE IF NOT EXISTS "AP_artifacts" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'doc',
  url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AP_artifacts_project_id_idx" ON "AP_artifacts"(project_id);

CREATE TABLE IF NOT EXISTS "AP_timeline" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AP_timeline_project_id_idx" ON "AP_timeline"(project_id, created_at);

CREATE TABLE IF NOT EXISTS "AP_project_actions" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES "AP_projects"(id),
  action TEXT NOT NULL,
  next_action TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. Digest Pipeline tables (L0→L3 output)
-- ============================================================

-- L1.5 aggregated activities per bot per day
CREATE TABLE IF NOT EXISTS "AP_daily_activities" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT,
  action TEXT,
  content TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_activities_agent_date ON "AP_daily_activities" (agent_id, date);

-- L1 granular timeline events per bot per day
CREATE TABLE IF NOT EXISTS "AP_daily_timeline" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT,
  who TEXT,
  action TEXT,
  content TEXT,
  status TEXT,
  deliverables JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_timeline_agent_date ON "AP_daily_timeline" (agent_id, date);

-- L2/L3 daily reports (one per bot per day)
CREATE TABLE IF NOT EXISTS "AP_daily_reports" (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  content TEXT NOT NULL,
  agent_id TEXT DEFAULT 'research',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, agent_id)
);
CREATE INDEX IF NOT EXISTS "AP_daily_reports_date_idx" ON "AP_daily_reports"(date DESC);

-- Daily insights (aggregated across all bots)
CREATE TABLE IF NOT EXISTS "AP_daily_insights" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  things_done JSONB DEFAULT '[]'::jsonb,
  needs_attention JSONB DEFAULT '[]'::jsonb,
  bot_summaries JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_insights_date ON "AP_daily_insights" (date DESC);

-- ============================================================
-- 3. Bot registry
-- ============================================================

CREATE TABLE IF NOT EXISTS "AP_bots" (
  agent_id TEXT PRIMARY KEY,
  name TEXT,
  emoji TEXT DEFAULT '🤖',
  mm_user_id TEXT,
  mm_username TEXT,
  role TEXT,
  server TEXT,
  project_slug TEXT,
  github_url TEXT,
  prod_url TEXT,
  dev_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. AI-generated project tracking (Kanban view)
-- ============================================================

CREATE TABLE IF NOT EXISTS "AP_projects_v2" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'discovering',
  first_seen DATE,
  last_active DATE,
  involved_bots TEXT[],
  primary_bot TEXT,
  milestones JSONB DEFAULT '[]'::jsonb,
  next_actions JSONB DEFAULT '[]'::jsonb,
  deliverables JSONB DEFAULT '[]'::jsonb,
  tags TEXT[],
  user_notes TEXT,
  auto_generated BOOLEAN DEFAULT TRUE,
  merged_into UUID,
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- 5. Infrastructure monitoring (Quokka snapshots)
-- ============================================================

CREATE TABLE IF NOT EXISTS "AP_server_snapshots" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_time TIMESTAMPTZ NOT NULL,
  collector TEXT NOT NULL DEFAULT 'quokka',
  name TEXT NOT NULL,
  ip TEXT,
  internal_ip TEXT,
  region TEXT,
  cloud TEXT,
  resource_group TEXT,
  role TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  os TEXT,
  cpu_cores INTEGER,
  memory_total_mb INTEGER,
  memory_used_mb INTEGER,
  disk_total_gb INTEGER,
  disk_used_gb INTEGER,
  disk_usage_pct INTEGER,
  uptime_seconds BIGINT,
  ssh_port INTEGER DEFAULT 18822,
  ssh_user TEXT,
  ssh_reachable BOOLEAN,
  services JSONB DEFAULT '[]'::jsonb,
  listening_ports JSONB DEFAULT '[]'::jsonb,
  alerts JSONB DEFAULT '[]'::jsonb,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AP_site_checks" (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  project_slug TEXT,
  kind TEXT NOT NULL,
  http_status INTEGER,
  port INTEGER,
  snapshot_time TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_site_checks_name ON "AP_site_checks" (name, kind, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_site_checks_time ON "AP_site_checks" (snapshot_time DESC);

CREATE TABLE IF NOT EXISTS "AP_container_checks" (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT,
  status_text TEXT,
  running BOOLEAN,
  ports TEXT,
  snapshot_time TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_container_checks_name ON "AP_container_checks" (name, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_container_checks_time ON "AP_container_checks" (snapshot_time DESC);

CREATE TABLE IF NOT EXISTS "AP_cron_checks" (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT,
  agent_id TEXT,
  enabled BOOLEAN,
  schedule TEXT,
  model TEXT,
  last_status TEXT,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  consecutive_errors INTEGER DEFAULT 0,
  snapshot_time TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cron_checks_job ON "AP_cron_checks" (job_id, snapshot_time DESC);
CREATE INDEX IF NOT EXISTS idx_cron_checks_time ON "AP_cron_checks" (snapshot_time DESC);
