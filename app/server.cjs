const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3013;
const MIME_TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const CHANGELOG_TTL_MS = 5 * 60 * 1000;
const changelogCache = new Map();

// ── Database ──
// DATABASE_URL=postgresql://agent_portal:AgentP0rtal2026!@localhost:5432/postgres
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
// Legacy Supabase fallback (remove after migration confirmed)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://db.dora.restry.cn';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

// ── Portal Chat (Mattermost DM as @dora via admin token) ──
const MM_ADMIN_TOKEN = process.env.MM_ADMIN_TOKEN || 'ygw5qt86hi8p3r917j7khe3ogc';
const MM_ADMIN_USER_ID = '8zzs18ha4fdhf8jt8ybm61eqdw'; // @dora
// Legacy aliases for backward compat
const PORTAL_OPS_TOKEN = MM_ADMIN_TOKEN;
const PORTAL_OPS_USER_ID = MM_ADMIN_USER_ID;
const MM_BASE_URL = process.env.MM_BASE_URL || 'https://mm.dora.restry.cn';

// ── MM Bot User Cache (for merging daily_reports bots) ──
const mmBotUserCache = {};
async function loadMmBotUsers() {
  try {
    const res = await fetch(`${MM_BASE_URL}/api/v4/users?per_page=200`, {
      headers: { Authorization: `Bearer ${MM_ADMIN_TOKEN}` },
    });
    if (!res.ok) { console.error('[MM] Failed to load bot users:', res.status); return; }
    const users = await res.json();
    const bots = users.filter(u => u.is_bot);
    for (const b of bots) {
      mmBotUserCache[b.username] = { id: b.id, nickname: b.nickname || b.username };
    }
    // agent_id → mm_username mappings (from pusher.py)
    const AGENT_ID_MAP = {
      'rabbit': 'ottor-pc-cloud-bot',
      'clawline-channel': 'channelbot',
      'clawline-client-web': 'webbot',
      'clawline-gateway': 'gatewaybot',
      'research': 'researcher',
      'research-craft': 'craftbot',
      'research-portal': 'portalbot',
      'research-bi': 'bibot',
    };
    for (const [agentId, mmUsername] of Object.entries(AGENT_ID_MAP)) {
      if (mmBotUserCache[mmUsername] && !mmBotUserCache[agentId]) {
        mmBotUserCache[agentId] = mmBotUserCache[mmUsername];
      }
    }
    console.log(`[MM] Loaded ${Object.keys(mmBotUserCache).length} bot user entries`);
  } catch (e) {
    console.error('[MM] Error loading bot users:', e.message);
  }
}
loadMmBotUsers();

const STAGE_LABELS = {
  idea: '想法',
  plan: '方案',
  build: '验证',
  ship: '落地',
  // Legacy compat
  question: '想法',
  literature: '方案',
  hypothesis: '方案',
  poc: '验证',
  conclusion: '落地',
  report: '落地',
};

const STATUS_LABELS = {
  active: '进行中',
  paused: '暂停',
  completed: '已完成',
  archived: '已归档',
};

const STATIC_ROOT = process.env.STATIC_DIR || path.join(__dirname, 'dist');
app.use(express.json());
app.use(express.static(STATIC_ROOT));

async function dbQuery(sql) {
  if (pool) {
    const { rows } = await pool.query(sql);
    return rows;
  }
  // Supabase HTTP fallback
  const res = await fetch(`${SUPABASE_URL}/pg/rest/v1/rpc/run_sql`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json();
}

// For DDL statements (CREATE TABLE/INDEX etc) that don't return rows
async function dbExec(sql) {
  if (pool) {
    await pool.query(sql);
    return;
  }
  // Supabase HTTP fallback
  const res = await fetch(`${SUPABASE_URL}/pg/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB exec error (${res.status}): ${text.slice(0, 300)}`);
  }
}

function esc(value) {
  if (value == null) return '';
  return String(value).replace(/'/g, "''");
}

function toJsonb(value) {
  return `'${esc(JSON.stringify(value ?? {}))}'::jsonb`;
}

function getStageLabel(stage) {
  return STAGE_LABELS[stage] || stage;
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function clip(text, maxLength = 80) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}...`;
}

async function getProjectById(projectId) {
  const rows = await dbQuery(`SELECT * FROM "AP_projects" WHERE id = '${esc(projectId)}' LIMIT 1`);
  return rows[0] || null;
}

async function getTaskById(taskId) {
  const rows = await dbQuery(`SELECT * FROM "AP_tasks" WHERE id = '${esc(taskId)}' LIMIT 1`);
  return rows[0] || null;
}

async function recordTimeline(projectId, eventType, description, metadata = {}) {
  await dbQuery(`
    INSERT INTO "AP_timeline" (project_id, event_type, description, metadata)
    VALUES ('${esc(projectId)}', '${esc(eventType)}', '${esc(description)}', ${toJsonb(metadata)})
  `);
}

function getRequiredProjectId(req, res) {
  const projectId = req.query.project_id || (req.body && req.body.project_id);
  if (!projectId) {
    res.status(400).json({ error: '缺少 project_id' });
    return null;
  }
  return String(projectId);
}

function getArtifactId(req) {
  return req.params.id || req.query.id || (req.body && req.body.id) || null;
}

app.post('/api/init-db', async (req, res) => {
  try {
    // -- 1. Core project management --
    await dbExec(`
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
    `);

    await dbExec(`
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
    `);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_notes" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'finding',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbExec(`
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
    `);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_timeline" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_project_actions" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES "AP_projects"(id),
        action TEXT NOT NULL,
        next_action TEXT,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbExec(`CREATE INDEX IF NOT EXISTS "AP_tasks_project_id_idx" ON "AP_tasks"(project_id);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS "AP_notes_project_id_idx" ON "AP_notes"(project_id);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS "AP_artifacts_project_id_idx" ON "AP_artifacts"(project_id);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS "AP_timeline_project_id_idx" ON "AP_timeline"(project_id, created_at);`);

    // -- 2. Digest Pipeline tables --
    await dbExec(`
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
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_daily_activities_agent_date ON "AP_daily_activities" (agent_id, date);`);

    await dbExec(`
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
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_daily_timeline_agent_date ON "AP_daily_timeline" (agent_id, date);`);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_daily_reports" (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT DEFAULT 'research',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(date, agent_id)
      );
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS "AP_daily_reports_date_idx" ON "AP_daily_reports"(date DESC);`);

    await dbExec(`
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
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_daily_insights_date ON "AP_daily_insights" (date DESC);`);

    // -- 3. Bot registry --
    await dbExec(`
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
    `);

    // -- 4. AI project tracking (Kanban) --
    await dbExec(`
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
    `);

    // -- 5. Infrastructure monitoring --
    await dbExec(`
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
    `);

    await dbExec(`
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
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_site_checks_name ON "AP_site_checks" (name, kind, snapshot_time DESC);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_site_checks_time ON "AP_site_checks" (snapshot_time DESC);`);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_container_checks" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        image TEXT,
        status_text TEXT,
        running BOOLEAN,
        ports TEXT,
        snapshot_time TIMESTAMPTZ DEFAULT now()
      );
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_container_checks_name ON "AP_container_checks" (name, snapshot_time DESC);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_container_checks_time ON "AP_container_checks" (snapshot_time DESC);`);

    await dbExec(`
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
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_cron_checks_job ON "AP_cron_checks" (job_id, snapshot_time DESC);`);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_cron_checks_time ON "AP_cron_checks" (snapshot_time DESC);`);

    // -- 6. Health Monitoring --
    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_monitors" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'http',
        target TEXT NOT NULL,
        interval_sec INT DEFAULT 300,
        timeout_ms INT DEFAULT 5000,
        expected_status INT DEFAULT 200,
        keyword TEXT,
        tags TEXT[] DEFAULT '{}',
        project_slug TEXT,
        group_name TEXT DEFAULT '其他',
        enabled BOOLEAN DEFAULT true,
        paused BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_monitors_enabled ON "AP_monitors" (enabled, group_name);`);

    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_incidents" (
        id SERIAL PRIMARY KEY,
        monitor_id INT REFERENCES "AP_monitors"(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ NOT NULL,
        resolved_at TIMESTAMPTZ,
        duration_sec INT,
        cause TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await dbExec(`CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON "AP_incidents" (monitor_id, started_at DESC);`);

    // Add response_ms column to AP_site_checks if missing
    await dbExec(`ALTER TABLE "AP_site_checks" ADD COLUMN IF NOT EXISTS response_ms INT;`);

    // Seed initial monitors if empty
    const monitorCount = await dbQuery(`SELECT count(*) AS c FROM "AP_monitors"`);
    if (Number(monitorCount[0]?.c || 0) === 0) {
      await dbExec(`
        INSERT INTO "AP_monitors" (name, type, target, group_name, project_slug) VALUES
          ('ClawCraft', 'http', 'https://craft.clawlines.net', '生产环境', 'clawcraft'),
          ('Agent Portal', 'http', 'https://agent-project.clawlines.net', '生产环境', 'agent-portal'),
          ('Agentic BI', 'http', 'https://bi.clawlines.net', '生产环境', 'agentic-bi'),
          ('Gateway', 'http', 'https://gateway.clawlines.net', '生产环境', 'clawline'),
          ('Client Web', 'http', 'https://chat.clawlines.net', '生产环境', 'clawline'),
          ('ClawCraft Dev', 'http', 'https://craft.dev.dora.restry.cn', '开发环境', 'clawcraft'),
          ('Agent Portal Dev', 'http', 'https://portal.dev.dora.restry.cn', '开发环境', 'agent-portal'),
          ('Agentic BI Dev', 'http', 'https://bi.dev.dora.restry.cn', '开发环境', 'agentic-bi'),
          ('Gateway Dev', 'http', 'https://gw.dev.dora.restry.cn', '开发环境', 'clawline'),
          ('Client Web Dev', 'http', 'https://web.dev.dora.restry.cn', '开发环境', 'clawline')
      `);
    }

    res.json({ ok: true, message: 'All 18 tables created/verified' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const total = await dbQuery('SELECT count(*) AS c FROM "AP_projects"');
    const active = await dbQuery(`SELECT count(*) AS c FROM "AP_projects" WHERE status = 'active'`);
    const completed = await dbQuery(`SELECT count(*) AS c FROM "AP_projects" WHERE status = 'completed'`);
    const tasks = await dbQuery('SELECT count(*) AS c FROM "AP_tasks"');
    const tasksDone = await dbQuery(`SELECT count(*) AS c FROM "AP_tasks" WHERE status = 'done'`);

    res.json({
      total: Number(total[0]?.c || 0),
      active: Number(active[0]?.c || 0),
      completed: Number(completed[0]?.c || 0),
      tasks: Number(tasks[0]?.c || 0),
      tasksDone: Number(tasksDone[0]?.c || 0),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getLatestServerSnapshots(at = null) {
  const timeFilter = at ? `WHERE snapshot_time <= '${esc(at)}'` : '';
  return dbQuery(`
    SELECT DISTINCT ON (name) *
    FROM "AP_server_snapshots"
    ${timeFilter}
    ORDER BY name, snapshot_time DESC
  `);
}

app.get('/api/servers', async (req, res) => {
  try {
    const at = req.query.at ? String(req.query.at) : null;
    const servers = await getLatestServerSnapshots(at);
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/history', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 120);
    const rows = await dbQuery(`
      SELECT snapshot_time AS ts, 'server' AS source FROM "AP_server_snapshots"
      ORDER BY ts DESC
      LIMIT ${limit}
    `);
    const serverPoints = [];
    const seenServer = new Set();
    for (const row of rows ?? []) {
      const iso = row.ts ? new Date(row.ts).toISOString() : null;
      if (!iso) continue;
      if (!seenServer.has(iso)) {
        seenServer.add(iso);
        serverPoints.push(iso);
      }
    }
    const points = [...serverPoints];
    res.json({ points, botPoints: [], serverPoints });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const at = req.query.at ? String(req.query.at) : null;
    const timeFilter = at ? `WHERE snapshot_time <= '${esc(at)}'` : '';

    const [sites, containers, crons, bots, servers] = await Promise.all([
      dbQuery(`SELECT DISTINCT ON (name, kind) * FROM "AP_site_checks" ${timeFilter} ORDER BY name, kind, snapshot_time DESC`),
      dbQuery(`SELECT DISTINCT ON (name) * FROM "AP_container_checks" ${timeFilter} ORDER BY name, snapshot_time DESC`),
      dbQuery(`SELECT DISTINCT ON (job_id) * FROM "AP_cron_checks" ${timeFilter} ORDER BY job_id, snapshot_time DESC`),
      dbQuery(`SELECT b.*, la.last_active FROM "AP_bots" b LEFT JOIN (SELECT agent_id, MAX(date || 'T' || RIGHT("time", 5) || ':00+08:00') as last_active FROM "AP_daily_activities" GROUP BY agent_id) la ON b.agent_id = la.agent_id ORDER BY la.last_active DESC NULLS LAST, b.agent_id`),
      getLatestServerSnapshots(at),
    ]);

    const productionSites = (sites ?? []).filter(s => s.kind === 'production').map(s => ({
      name: s.name, url: s.url, project: s.project_slug, status: s.http_status, checkedAt: s.snapshot_time,
    }));
    const devServers = (sites ?? []).filter(s => s.kind === 'dev').map(s => ({
      name: s.name, url: s.url, port: s.port, status: s.http_status, checkedAt: s.snapshot_time,
    }));
    const containerList = (containers ?? []).map(c => ({
      name: c.name, image: c.image, status: c.status_text, running: c.running, ports: c.ports,
    }));
    const cronList = (crons ?? []).map(c => ({
      id: c.job_id, name: c.name, agent: c.agent_id, enabled: c.enabled,
      schedule: c.schedule, model: c.model, lastStatus: c.last_status,
      lastRun: c.last_run, nextRun: c.next_run, consecutiveErrors: c.consecutive_errors,
    }));
    const agentList = (bots ?? []).map(a => ({
      id: a.agent_id, name: a.name, emoji: a.emoji, role: a.role,
      project: a.project_slug, github: a.github_url, mm_user_id: a.mm_user_id,
      mm_username: a.mm_username, last_active: a.last_active || null,
      production: a.prod_url ? { url: a.prod_url } : null,
      dev: a.dev_url ? { url: a.dev_url } : null,
      container: null,
      crons: null,
      tasks: null,
    }));

    const prodUp = productionSites.filter(s => s.status === 200).length;
    const devUp = devServers.filter(s => s.status === 200).length;
    const latestSnapshot = (servers ?? []).reduce((max, s) => {
      const t = s.snapshot_time ? new Date(s.snapshot_time).getTime() : 0;
      return t > max ? t : max;
    }, 0);

    res.json({
      summary: {
        production: { total: productionSites.length, up: prodUp },
        dev: { total: devServers.length, up: devUp },
        containers: { total: containerList.length, up: containerList.filter(c => c.running).length },
        crons: { total: cronList.length, ok: cronList.filter(c => c.lastStatus === 'ok').length, error: cronList.filter(c => c.lastStatus === 'error').length },
        agents: { total: agentList.length },
      },
      production_sites: productionSites,
      dev_servers: devServers,
      containers: containerList,
      cron_jobs: cronList,
      agents: agentList,
      servers,
      updated_at: latestSnapshot ? new Date(latestSnapshot).toISOString() : null,
      as_of: at || (latestSnapshot ? new Date(latestSnapshot).toISOString() : null),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Daily Insights API (from AP_daily_insights) ──
app.get('/api/insights', async (req, res) => {
  try {
    const date = req.query.date;
    let sql;
    if (date) {
      sql = `SELECT * FROM "AP_daily_insights" WHERE date = '${esc(date)}' LIMIT 1`;
    } else {
      sql = `SELECT * FROM "AP_daily_insights" ORDER BY date DESC LIMIT 1`;
    }
    const rows = await dbQuery(sql);
    if (!rows || rows.length === 0) {
      return res.json({ things_done: [], needs_attention: [], bot_summaries: [], date: date || null });
    }
    const row = rows[0];
    res.json({
      date: row.date,
      things_done: row.things_done ?? [],
      needs_attention: row.needs_attention ?? [],
      bot_summaries: row.bot_summaries ?? [],
      metadata: row.metadata ?? {},
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Daily Insights dates (for time switcher) ──
app.get('/api/insights/dates', async (req, res) => {
  try {
    const rows = await dbQuery(`SELECT date FROM "AP_daily_insights" ORDER BY date DESC LIMIT 30`);
    res.json((rows ?? []).map(r => r.date));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Daily Report for a specific bot ──
app.get('/api/reports/:agentId', async (req, res) => {
  try {
    const date = req.query.date;
    let sql;
    if (date) {
      sql = `SELECT * FROM "AP_daily_reports" WHERE agent_id = '${esc(req.params.agentId)}' AND date = '${esc(date)}' LIMIT 1`;
    } else {
      sql = `SELECT * FROM "AP_daily_reports" WHERE agent_id = '${esc(req.params.agentId)}' ORDER BY date DESC LIMIT 1`;
    }
    const rows = await dbQuery(sql);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No report found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Helper: parse JSON string fields ──
function parseJsonField(val) {
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
  return val;
}
function parseActivityRows(rows) {
  return (rows ?? []).map(r => ({ ...r, detail: parseJsonField(r.detail) }));
}
function parseTimelineRows(rows) {
  return (rows ?? []).map(r => ({ ...r, deliverables: parseJsonField(r.deliverables) }));
}

// ── Daily Activities for a specific bot ──
app.get('/api/activities/:agentId', async (req, res) => {
  try {
    const date = req.query.date;
    let dateFilter = '';
    if (date) {
      dateFilter = `AND date = '${esc(date)}'`;
    }
    const rows = await dbQuery(`SELECT * FROM "AP_daily_activities" WHERE agent_id = '${esc(req.params.agentId)}' ${dateFilter} ORDER BY time ASC`);
    res.json(parseActivityRows(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Compat: frontend uses /api/daily-activities?agent_id=xxx ──
app.get('/api/daily-activities', async (req, res) => {
  try {
    const agentId = req.query.agent_id;
    if (!agentId) return res.json([]);
    const date = req.query.date;
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    let dateFilter = '';
    if (date) {
      dateFilter = `AND date = '${esc(date)}'`;
    }
    const rows = await dbQuery(`SELECT * FROM "AP_daily_activities" WHERE agent_id = '${esc(agentId)}' ${dateFilter} ORDER BY date DESC, time DESC LIMIT ${limit} OFFSET ${offset}`);
    res.json(parseActivityRows(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Compat: frontend uses /api/daily-activities/dates?agent_id=xxx ──
app.get('/api/daily-activities/dates', async (req, res) => {
  try {
    const agentId = req.query.agent_id;
    if (!agentId) return res.json([]);
    const rows = await dbQuery(`SELECT DISTINCT date FROM "AP_daily_activities" WHERE agent_id = '${esc(agentId)}' ORDER BY date DESC LIMIT 30`);
    res.json((rows ?? []).map(r => r.date));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Daily Timeline: granular L1 events per bot ──
app.get('/api/daily-timeline', async (req, res) => {
  try {
    const agentId = req.query.agent_id;
    if (!agentId) return res.json([]);
    const date = req.query.date;
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    let dateFilter = '';
    if (date) {
      dateFilter = `AND date = '${esc(date)}'`;
    }
    const rows = await dbQuery(`SELECT * FROM "AP_daily_timeline" WHERE agent_id = '${esc(agentId)}' ${dateFilter} ORDER BY date DESC, time DESC LIMIT ${limit} OFFSET ${offset}`);
    res.json(parseTimelineRows(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Legacy daily-reports endpoints (now using AP_daily_reports) ──
app.get('/api/daily-reports', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 30));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const agentId = String(req.query.agentId || '').trim();
    const whereClause = agentId ? `WHERE agent_id = '${esc(agentId)}'` : '';
    const rows = await dbQuery(`
      SELECT id, date, content, agent_id, created_at, updated_at
      FROM "AP_daily_reports"
      ${whereClause}
      ORDER BY date DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/daily-reports/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date 格式必须为 YYYY-MM-DD' });
    }
    const rows = await dbQuery(`
      SELECT id, date, content, agent_id, created_at, updated_at
      FROM "AP_daily_reports"
      WHERE date = '${esc(date)}'
      LIMIT 1
    `);
    if (!rows.length) {
      return res.status(404).json({ error: '日报不存在' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/daily-reports', async (req, res) => {
  try {
    const { date, content, agentId } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'date 格式必须为 YYYY-MM-DD' });
    }
    if (!String(content || '').trim()) {
      return res.status(400).json({ error: 'content 不能为空' });
    }
    const rows = await dbQuery(`
      INSERT INTO "AP_daily_reports" (date, content, agent_id)
      VALUES (
        '${esc(date)}',
        '${esc(content)}',
        '${esc(agentId || 'research')}'
      )
      ON CONFLICT (date, agent_id)
      DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = NOW()
      RETURNING id, date, content, agent_id, created_at, updated_at
    `);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const rows = await dbQuery(`
      SELECT p.*,
        (SELECT count(*) FROM "AP_tasks" t WHERE t.project_id = p.id) AS task_count,
        (SELECT count(*) FROM "AP_tasks" t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done,
        (SELECT count(*) FROM "AP_artifacts" a WHERE a.project_id = p.id) AS artifact_count,
        (SELECT max(created_at) FROM "AP_timeline" tl WHERE tl.project_id = p.id) AS last_activity_at
      FROM "AP_projects" p
      ORDER BY p.created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:slug', async (req, res) => {
  try {
    const projects = await dbQuery(`
      SELECT *
      FROM "AP_projects"
      WHERE slug = '${esc(req.params.slug)}'
      LIMIT 1
    `);

    if (!projects.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    const project = projects[0];
    const tasks = await dbQuery(`
      SELECT *
      FROM "AP_tasks"
      WHERE project_id = '${esc(project.id)}'
      ORDER BY priority DESC, created_at ASC
    `);
    const notes = await dbQuery(`
      SELECT *
      FROM "AP_notes"
      WHERE project_id = '${esc(project.id)}'
      ORDER BY created_at DESC
    `);
    res.json({ ...project, tasks, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, description, emoji, stage } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: '项目名称不能为空' });
    }

    const initialStage = stage || 'question';
    const slug = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const rows = await dbQuery(`
      INSERT INTO "AP_projects" (name, slug, description, emoji, stage)
      VALUES (
        '${esc(name)}',
        '${esc(slug)}',
        '${esc(description || '')}',
        '${esc(emoji || '🔬')}',
        '${esc(initialStage)}'
      )
      RETURNING *
    `);

    const project = rows[0];
    await recordTimeline(project.id, 'status_change', '项目已创建，当前状态为「进行中」', {
      status: project.status,
    });
    await recordTimeline(project.id, 'stage_change', `项目启动，进入「${getStageLabel(project.stage)}」阶段`, {
      from: null,
      to: project.stage,
    });

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const current = await getProjectById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: '项目不存在' });
    }

    const { name, description, emoji, stage, status } = req.body || {};
    const sets = [];

    if (name !== undefined) sets.push(`name = '${esc(name)}'`);
    if (description !== undefined) sets.push(`description = '${esc(description)}'`);
    if (emoji !== undefined) sets.push(`emoji = '${esc(emoji)}'`);
    if (stage !== undefined) sets.push(`stage = '${esc(stage)}'`);
    if (status !== undefined) sets.push(`status = '${esc(status)}'`);
    sets.push('updated_at = now()');

    const rows = await dbQuery(`
      UPDATE "AP_projects"
      SET ${sets.join(', ')}
      WHERE id = '${esc(req.params.id)}'
      RETURNING *
    `);

    const project = rows[0];

    if (stage !== undefined && stage !== current.stage) {
      await recordTimeline(project.id, 'stage_change', `阶段从「${getStageLabel(current.stage)}」切换到「${getStageLabel(project.stage)}」`, {
        from: current.stage,
        to: project.stage,
      });
    }

    if (status !== undefined && status !== current.status) {
      await recordTimeline(project.id, 'status_change', `项目状态从「${getStatusLabel(current.status)}」更新为「${getStatusLabel(project.status)}」`, {
        from: current.status,
        to: project.status,
      });
    }

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { project_id: projectId, title, description, stage, status, priority } = req.body || {};
    if (!String(projectId || '').trim() || !String(title || '').trim() || !String(stage || '').trim()) {
      return res.status(400).json({ error: '任务缺少 project_id、title 或 stage' });
    }

    const normalizedPriority = Number.parseInt(priority, 10) || 0;
    const normalizedStatus = status || 'pending';

    const rows = await dbQuery(`
      INSERT INTO "AP_tasks" (project_id, title, description, stage, status, priority)
      VALUES (
        '${esc(projectId)}',
        '${esc(title)}',
        '${esc(description || '')}',
        '${esc(stage)}',
        '${esc(normalizedStatus)}',
        ${normalizedPriority}
      )
      RETURNING *
    `);

    const task = rows[0];

    if (task.status === 'done') {
      await recordTimeline(task.project_id, 'task_done', `任务完成：${task.title}`, {
        task_id: task.id,
        stage: task.stage,
      });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const current = await getTaskById(req.params.id);
    if (!current) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const { title, description, stage, status, priority } = req.body || {};
    const sets = [];

    if (title !== undefined) sets.push(`title = '${esc(title)}'`);
    if (description !== undefined) sets.push(`description = '${esc(description)}'`);
    if (stage !== undefined) sets.push(`stage = '${esc(stage)}'`);
    if (status !== undefined) sets.push(`status = '${esc(status)}'`);
    if (priority !== undefined) sets.push(`priority = ${Number.parseInt(priority, 10) || 0}`);
    sets.push('updated_at = now()');

    const rows = await dbQuery(`
      UPDATE "AP_tasks"
      SET ${sets.join(', ')}
      WHERE id = '${esc(req.params.id)}'
      RETURNING *
    `);

    const task = rows[0];

    if (task.status === 'done' && current.status !== 'done') {
      await recordTimeline(task.project_id, 'task_done', `任务完成：${task.title}`, {
        task_id: task.id,
        stage: task.stage,
        previous_status: current.status,
      });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await dbQuery(`DELETE FROM "AP_tasks" WHERE id = '${esc(req.params.id)}'`);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notes', async (req, res) => {
  try {
    const { project_id: projectId, content, type } = req.body || {};
    if (!String(projectId || '').trim() || !String(content || '').trim()) {
      return res.status(400).json({ error: '笔记缺少 project_id 或 content' });
    }

    const rows = await dbQuery(`
      INSERT INTO "AP_notes" (project_id, content, type)
      VALUES ('${esc(projectId)}', '${esc(content)}', '${esc(type || 'finding')}')
      RETURNING *
    `);

    const note = rows[0];
    await recordTimeline(note.project_id, 'note_added', `新增笔记：${clip(note.content)}`, {
      note_id: note.id,
      type: note.type,
    });

    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/artifacts', async (req, res) => {
  const projectId = getRequiredProjectId(req, res);
  if (!projectId) return;

  try {
    const rows = await dbQuery(`
      SELECT *
      FROM "AP_artifacts"
      WHERE project_id = '${esc(projectId)}'
      ORDER BY created_at DESC
    `);

    res.json(rows.filter((artifact) => artifactUrlIsAvailable(artifact.url)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/artifacts', async (req, res) => {
  try {
    const { project_id: projectId, stage, title, type, url, description } = req.body || {};
    if (!String(projectId || '').trim() || !String(stage || '').trim() || !String(title || '').trim()) {
      return res.status(400).json({ error: '产出物缺少 project_id、stage 或 title' });
    }

    const rows = await dbQuery(`
      INSERT INTO "AP_artifacts" (project_id, stage, title, type, url, description)
      VALUES (
        '${esc(projectId)}',
        '${esc(stage)}',
        '${esc(title)}',
        '${esc(type || 'doc')}',
        '${esc(url || '')}',
        '${esc(description || '')}'
      )
      RETURNING *
    `);

    const artifact = rows[0];
    await recordTimeline(artifact.project_id, 'artifact_added', `新增产出物：${artifact.title}`, {
      artifact_id: artifact.id,
      stage: artifact.stage,
      type: artifact.type,
      url: artifact.url,
    });

    res.json(artifact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function deleteArtifact(req, res) {
  const artifactId = getArtifactId(req);
  if (!artifactId) {
    return res.status(400).json({ error: '缺少 artifact id' });
  }

  try {
    await dbQuery(`DELETE FROM "AP_artifacts" WHERE id = '${esc(artifactId)}'`);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.delete('/api/artifacts', deleteArtifact);
app.delete('/api/artifacts/:id', deleteArtifact);

app.get('/api/timeline', async (req, res) => {
  const projectId = getRequiredProjectId(req, res);
  if (!projectId) return;

  try {
    const rows = await dbQuery(`
      SELECT *
      FROM "AP_timeline"
      WHERE project_id = '${esc(projectId)}'
      ORDER BY created_at ASC
    `);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ───────────────────────────────────────────────────────
// Workspace Scanner — 自动扫描关键产出物 + 部署信息
// ───────────────────────────────────────────────────────
const fs = require('fs');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../../..');
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS) || 5 * 60 * 1000; // 5 min

// Project registry: slug → { dir, deployments, keyDocs }
const PROJECT_REGISTRY = {
  clawcraft: {
    dir: 'clawcraft',
    githubRepo: 'msdevhub/clawcraft',
    deployments: [
      { stage: 'build', title: 'ClawCraft 游戏界面', type: 'link', url: 'http://proxy-kr-tiger.koreacentral.cloudapp.azure.com:18789/', description: '帝国时代风格 Agent 可视化游戏 — PixiJS + React + shadcn' },
    ],
    keyDocs: [
      { path: 'PRD.md', stage: 'idea', title: 'PRD 产品需求文档', type: 'doc' },
      { path: 'README.md', stage: 'idea', title: '项目说明', type: 'doc' },
      { path: 'test-cases.md', stage: 'build', title: '测试用例 (37条)', type: 'doc' },
      { path: 'research/engine-survey.md', stage: 'plan', title: '2D 游戏引擎调研', type: 'doc' },
      { path: 'research/api-surface.md', stage: 'plan', title: 'API 接口映射设计', type: 'doc' },
      { path: 'research/scenario-debate-report.md', stage: 'plan', title: '场景辩论报告', type: 'doc' },
      { path: 'REPORT.md', stage: 'ship', title: '研究报告', type: 'doc' },
    ],
  },
  'agentic-bi': {
    dir: 'agentic-bi',
    githubRepo: null,
    deployments: [],
    keyDocs: [
      { path: 'README.md', stage: 'idea', title: '项目说明', type: 'doc' },
      { path: 'REPORT.md', stage: 'ship', title: '研究报告', type: 'doc' },
      { path: 'poc/v1-simple/ARCHITECTURE.md', stage: 'plan', title: '多智能体架构设计', type: 'doc' },
      { path: 'poc/v1-simple/README.md', stage: 'build', title: 'POC v1 说明', type: 'doc' },
    ],
  },
  'agent-portal': {
    dir: 'agent-portal',
    githubRepo: null,
    deployments: [
      { stage: 'build', title: 'Agent Portal 管理平台', type: 'link', url: 'https://agent-project.clawlines.net/', description: '研究项目管理平台 — React + shadcn + Supabase' },
    ],
    keyDocs: [
      { path: 'CONTEXT.md', stage: 'build', title: '项目上下文', type: 'doc' },
      { path: 'research/architecture.md', stage: 'plan', title: '系统方案设计', type: 'doc' },
      { path: 'DEPLOY.md', stage: 'build', title: '部署文档', type: 'doc' },
    ],
  },
};

function getChangelogProjectConfigs() {
  return [
    { slug: 'clawline-client-web', name: 'Clawline Client Web', githubRepo: 'clawline/client-web' },
    { slug: 'clawline-gateway', name: 'Clawline Gateway', githubRepo: 'clawline/gateway' },
    { slug: 'clawline-channel', name: 'Clawline Channel', githubRepo: 'clawline/channel' },
  ];
}

function getProjectGithubRepo(slug, projectName = '') {
  const registryRepo = PROJECT_REGISTRY[slug]?.githubRepo;
  if (registryRepo) return registryRepo;

  const matched = getChangelogProjectConfigs().find(item =>
    item.slug === slug || item.name.toLowerCase() === String(projectName || '').toLowerCase()
  );
  return matched?.githubRepo || null;
}

async function fetchGithubChangelog(repo) {
  const cacheKey = String(repo || '').trim().toLowerCase();
  const now = Date.now();
  const cached = changelogCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  const headers = {
    'User-Agent': 'agent-portal-changelog',
    Accept: 'application/vnd.github+json',
  };

  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_API_TOKEN || '';
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const response = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=30`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  const commits = Array.isArray(payload)
    ? payload.map(item => ({
        sha: item?.sha || '',
        message: item?.commit?.message || '',
        author: item?.commit?.author?.name || item?.author?.login || 'Unknown',
        date: item?.commit?.author?.date || item?.commit?.committer?.date || null,
      }))
    : [];

  const data = { commits };
  changelogCache.set(cacheKey, { data, expiresAt: now + CHANGELOG_TTL_MS });
  return data;
}

function artifactUrlIsAvailable(url) {
  if (!url) return true;

  try {
    const parsed = new URL(url, 'http://localhost');
    const match = parsed.pathname.match(/^\/api\/doc\/([^/]+)\/(.+)$/);
    if (match) {
      const slug = decodeURIComponent(match[1]);
      const docPath = decodeURIComponent(match[2]).replace(/\.\./g, '');
      const fullPath = path.join(WORKSPACE_ROOT, 'projects', slug, docPath);
      return fs.existsSync(fullPath);
    }
  } catch {}

  if (url.startsWith('file:///')) {
    const localPath = decodeURIComponent(url.slice('file://'.length));
    return fs.existsSync(localPath);
  }

  return true;
}

// Serve document content via API (so artifacts can link to viewable URLs)
app.get('/api/doc/:slug/{*path}', (req, res) => {
  const slug = req.params.slug;
  const docPath = req.params.path || '';
  const registry = PROJECT_REGISTRY[slug];
  if (!registry) return res.status(404).json({ error: '项目不存在' });

  const safePath = docPath.replace(/\.\./g, '');
  const fullPath = path.join(WORKSPACE_ROOT, 'projects', registry.dir, safePath);

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '文件不存在' });

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.md') {
      res.type('text/markdown; charset=utf-8').send(content);
    } else if (ext === '.json') {
      res.type('application/json').send(content);
    } else if (ext === '.html') {
      res.type('text/html').send(content);
    } else {
      res.type('text/plain; charset=utf-8').send(content);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/doc/:slug/* — 写入项目文档
app.put('/api/doc/:slug/{*path}', (req, res) => {
  const slug = req.params.slug;
  const docPath = req.params.path || '';
  const registry = PROJECT_REGISTRY[slug];
  if (!registry) return res.status(404).json({ error: '项目不存在' });

  const safePath = docPath.replace(/\.\./g, '');
  const fullPath = path.join(WORKSPACE_ROOT, 'projects', registry.dir, safePath);
  const content = req.body?.content;
  if (typeof content !== 'string') return res.status(400).json({ error: '缺少 content 字段' });

  try {
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/changelog/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '');
    const projects = await dbQuery(`
      SELECT id, slug, name, metadata
      FROM "AP_projects"
      WHERE slug = '${esc(slug)}'
      LIMIT 1
    `);

    if (!projects.length) {
      return res.status(404).json({ error: '项目不存在' });
    }

    const project = projects[0];
    const meta = project.metadata || {};
    const githubRepo = meta.githubRepo || getProjectGithubRepo(project.slug, project.name);
    if (!githubRepo) {
      return res.status(404).json({ error: '该项目未配置 GitHub 仓库，请在项目 metadata 中设置 githubRepo' });
    }

    const data = await fetchGithubChangelog(githubRepo);
    res.json({ githubRepo, commits: data.commits ?? [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/model-context/:slug — 模型实际加载的文件列表 + token 估算
app.get('/api/model-context/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const layers = [];

    // Layer 1: 永久加载 — workspace root .md files (system prompt injection)
    const permanentFiles = ['SOUL.md', 'AGENTS.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md', 'HEARTBEAT.md'];
    const permanent = [];
    for (const name of permanentFiles) {
      const fp = path.join(WORKSPACE_ROOT, name);
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp);
        permanent.push({ name, size: stat.size, mtime: stat.mtime.toISOString().slice(0, 10) });
      }
    }
    layers.push({ layer: 'permanent', label: '永久加载', description: '每次 session 自动注入 system prompt', files: permanent });

    // Layer 2: 项目上下文 — CONTEXT.md, tasks.json
    const projectDir = path.join(WORKSPACE_ROOT, 'projects', slug);
    const projectFiles = ['CONTEXT.md', 'tasks.json'];
    const project = [];
    for (const name of projectFiles) {
      const fp = path.join(projectDir, name);
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp);
        project.push({ name, size: stat.size, mtime: stat.mtime.toISOString().slice(0, 10) });
      }
    }
    layers.push({ layer: 'project', label: '项目上下文', description: 'project-focus 触发时加载', files: project });

    // Layer 3: Skills (on-demand, not always loaded)
    const skillsDir = path.join(WORKSPACE_ROOT, 'skills');
    const skills = [];
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const stat = fs.statSync(skillMd);
            skills.push({ name: `${entry.name}/SKILL.md`, size: stat.size, mtime: stat.mtime.toISOString().slice(0, 10) });
          }
        }
      }
    }
    layers.push({ layer: 'skills', label: '技能文件', description: '按需加载，触发对应技能时才读取', files: skills });

    // Calculate totals
    const alwaysLoaded = [...permanent, ...project];
    const totalAlwaysBytes = alwaysLoaded.reduce((sum, f) => sum + f.size, 0);
    const totalSkillsBytes = skills.reduce((sum, f) => sum + f.size, 0);
    // Rough token estimate: Chinese text ~0.3 tokens/byte, English ~0.25
    const estimatedTokens = Math.round(totalAlwaysBytes * 0.3);
    const maxTokens = 128000;

    res.json({
      layers,
      summary: {
        alwaysLoadedFiles: alwaysLoaded.length,
        alwaysLoadedBytes: totalAlwaysBytes,
        skillFiles: skills.length,
        skillBytes: totalSkillsBytes,
        estimatedTokens,
        maxTokens,
        usagePercent: Math.round((estimatedTokens / maxTokens) * 100),
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/context — 工作区顶层上下文文件列表
app.get('/api/context', (req, res) => {
  try {
    const entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => {
        const stat = fs.statSync(path.join(WORKSPACE_ROOT, e.name));
        return {
          name: e.name,
          path: e.name,
          size: stat.size,
          mtime: stat.mtime.toISOString().slice(0, 10),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memory — 记忆文件列表
app.get('/api/memory', (req, res) => {
  const memDir = path.join(WORKSPACE_ROOT, 'memory');
  try {
    if (!fs.existsSync(memDir)) return res.json([]);
    const entries = fs.readdirSync(memDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith('.md'))
      .map(e => {
        const stat = fs.statSync(path.join(memDir, e.name));
        return {
          name: e.name,
          path: `memory/${e.name}`,
          size: stat.size,
          mtime: stat.mtime.toISOString().slice(0, 10),
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name)); // newest first
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workspace/* — 读取工作区任意文件
app.get('/api/workspace/{*path}', (req, res) => {
  const filePath = (req.params.path || '').replace(/\.\./g, '');
  const fullPath = path.join(WORKSPACE_ROOT, filePath);

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '文件不存在' });

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.type('text/markdown; charset=utf-8').send(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/workspace/* — 写入工作区文件
app.put('/api/workspace/{*path}', (req, res) => {
  const filePath = (req.params.path || '').replace(/\.\./g, '');
  const fullPath = path.join(WORKSPACE_ROOT, filePath);
  const content = req.body?.content;
  if (typeof content !== 'string') return res.status(400).json({ error: '缺少 content 字段' });

  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function buildProjectArtifacts(slug) {
  const registry = PROJECT_REGISTRY[slug];
  if (!registry) return [];

  const basePath = path.join(WORKSPACE_ROOT, 'projects', registry.dir);
  const artifacts = [];

  // 1. Deployments (accessible URLs)
  for (const dep of registry.deployments) {
    artifacts.push({ ...dep, _key: `deploy:${dep.url}` });
  }

  // 2. Key documents (served via /api/doc/)
  for (const doc of registry.keyDocs) {
    const fullPath = path.join(basePath, doc.path);
    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    const sizeKB = Math.round(stat.size / 1024);
    artifacts.push({
      stage: doc.stage,
      title: doc.title,
      type: doc.type,
      url: `/api/doc/${slug}/${doc.path}`,
      description: `${sizeKB}KB · ${stat.mtime.toISOString().slice(0, 10)}`,
      _key: `doc:${doc.path}`,
    });
  }

  // 3. Auto-discover research/ folder docs not in keyDocs
  const researchDir = path.join(basePath, 'research');
  if (fs.existsSync(researchDir)) {
    const keyPaths = new Set(registry.keyDocs.map(d => d.path));
    try {
      const files = fs.readdirSync(researchDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile()) continue;
        const relPath = `research/${f.name}`;
        if (keyPaths.has(relPath)) continue;
        if (f.name.startsWith('.')) continue;

        const ext = path.extname(f.name).toLowerCase();
        if (!['.md', '.html', '.txt'].includes(ext)) continue;

        const stat = fs.statSync(path.join(researchDir, f.name));
        const sizeKB = Math.round(stat.size / 1024);
        artifacts.push({
          stage: 'literature',
          title: f.name.replace(/\.[^.]+$/, ''),
          type: 'doc',
          url: `/api/doc/${slug}/${relPath}`,
          description: `${sizeKB}KB · ${stat.mtime.toISOString().slice(0, 10)}`,
          _key: `doc:${relPath}`,
        });
      }
    } catch {}
  }

  return artifacts;
}

async function syncWorkspaceOnce() {
  console.log(`[sync] Workspace scan starting at ${new Date().toISOString()}`);
  const startMs = Date.now();

  try {
    const projects = await dbQuery('SELECT id, slug FROM "AP_projects"');
    let totalNew = 0;
    let totalSkipped = 0;

    for (const project of projects) {
      if (!PROJECT_REGISTRY[project.slug]) continue;

      const scanned = buildProjectArtifacts(project.slug);
      if (!scanned.length) continue;

      const existing = await dbQuery(
        `SELECT id, url FROM "AP_artifacts" WHERE project_id = '${esc(project.id)}'`
      );
      const existingUrls = new Set(existing.map(a => a.url));

      for (const art of scanned) {
        if (art.url && existingUrls.has(art.url)) { totalSkipped++; continue; }

        await dbQuery(`
          INSERT INTO "AP_artifacts" (project_id, stage, title, type, url, description)
          VALUES (
            '${esc(project.id)}',
            '${esc(art.stage)}',
            '${esc(art.title)}',
            '${esc(art.type || 'doc')}',
            '${esc(art.url || '')}',
            '${esc(art.description || '')}'
          )
        `);
        totalNew++;
      }
    }

    const elapsed = Date.now() - startMs;
    console.log(`[sync] Done in ${elapsed}ms — new: ${totalNew}, skipped: ${totalSkipped}`);
  } catch (error) {
    console.error(`[sync] Error:`, error.message);
  }
}

// Manual sync trigger
app.post('/api/sync-workspace', async (req, res) => {
  try {
    await syncWorkspaceOnce();
    res.json({ ok: true, message: '工作区同步完成' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Portal Ops: Send DM via portalops bot ──
app.post('/api/ops/send', async (req, res) => {
  try {
    const { target_user_id, message } = req.body || {};
    if (!target_user_id || !message) {
      return res.status(400).json({ error: '缺少 target_user_id 或 message' });
    }

    // 1. Create / get DM channel between portalops and target
    const channelRes = await fetch(`${MM_BASE_URL}/api/v4/channels/direct`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PORTAL_OPS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([PORTAL_OPS_USER_ID, target_user_id]),
    });
    if (!channelRes.ok) {
      const err = await channelRes.text();
      return res.status(502).json({ error: `MM create DM failed: ${err.slice(0, 300)}` });
    }
    const channel = await channelRes.json();

    // 2. Post message
    const postRes = await fetch(`${MM_BASE_URL}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PORTAL_OPS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: channel.id,
        message,
      }),
    });
    if (!postRes.ok) {
      const err = await postRes.text();
      return res.status(502).json({ error: `MM post failed: ${err.slice(0, 300)}` });
    }
    const post = await postRes.json();

    res.json({ ok: true, post_id: post.id, channel_id: channel.id });
    // Auto-track this channel for SSE push
    trackChannel(channel.id);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Portal Ops: Get/create DM channel between portalops and target ──
app.get('/api/ops/channel', async (req, res) => {
  try {
    const { target_user_id } = req.query;
    if (!target_user_id) {
      return res.status(400).json({ error: '缺少 target_user_id' });
    }
    const channelRes = await fetch(`${MM_BASE_URL}/api/v4/channels/direct`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PORTAL_OPS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([PORTAL_OPS_USER_ID, target_user_id]),
    });
    if (!channelRes.ok) {
      const err = await channelRes.text();
      return res.status(502).json({ error: `MM channel failed: ${err.slice(0, 300)}` });
    }
    const channel = await channelRes.json();
    // Auto-track for SSE
    trackChannel(channel.id);
    res.json({ channel_id: channel.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Portal Ops: Get messages from a DM channel ──
app.get('/api/ops/messages', async (req, res) => {
  try {
    const { channel_id, since } = req.query;
    if (!channel_id) {
      return res.status(400).json({ error: '缺少 channel_id' });
    }

    let url = `${MM_BASE_URL}/api/v4/channels/${encodeURIComponent(channel_id)}/posts`;
    if (since) {
      url += `?since=${encodeURIComponent(since)}`;
    } else {
      url += '?per_page=20';
    }

    const postsRes = await fetch(url, {
      headers: { Authorization: `Bearer ${PORTAL_OPS_TOKEN}` },
    });
    if (!postsRes.ok) {
      const err = await postsRes.text();
      return res.status(502).json({ error: `MM get posts failed: ${err.slice(0, 300)}` });
    }

    const data = await postsRes.json();
    // Normalize: return flat array of posts in chronological order
    const posts = (data.order ?? [])
      .map((id) => (data.posts ?? {})[id])
      .filter(Boolean)
      .reverse(); // chronological

    res.json({ posts, channel_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════ SSE + Mattermost WebSocket ══════════════

const https = require('https');
const http = require('http');

/** @type {Set<import('express').Response>} */
const sseClients = new Set();

// Track which channels we care about (portalops DM channels)
const trackedChannels = new Set();

// ── Bot real-time status tracking ──
// Maps mm_user_id -> { status: 'typing'|'active'|'idle', lastActivity: timestamp, lastMessage: string }
const botStatus = {};
const BOT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes → idle

// Build reverse lookup: mm_user_id → agent_id (loaded once from AP_bots)
const mmUserIdToAgentId = {};
async function loadBotStatusMap() {
  try {
    const bots = await dbQuery('SELECT agent_id, mm_user_id, emoji, name FROM "AP_bots" WHERE mm_user_id IS NOT NULL');
    for (const b of bots) {
      mmUserIdToAgentId[b.mm_user_id] = { agent_id: b.agent_id, emoji: b.emoji, name: b.name };
      botStatus[b.mm_user_id] = { status: 'idle', lastActivity: 0, lastMessage: '' };
    }
    console.log(`[BotStatus] Loaded ${Object.keys(mmUserIdToAgentId).length} bots for status tracking`);
  } catch (e) {
    console.error('[BotStatus] Failed to load:', e.message);
  }
}

function updateBotStatus(mmUserId, newStatus, message) {
  const bot = mmUserIdToAgentId[mmUserId];
  if (!bot) return; // not a tracked bot

  const prev = botStatus[mmUserId];
  const now = Date.now();
  botStatus[mmUserId] = { status: newStatus, lastActivity: now, lastMessage: message || prev?.lastMessage || '' };

  // Broadcast status change
  if (!prev || prev.status !== newStatus) {
    broadcastSSE('bot_status', {
      agent_id: bot.agent_id,
      mm_user_id: mmUserId,
      status: newStatus,
      lastMessage: botStatus[mmUserId].lastMessage,
      timestamp: now,
    });
  }
}

// Periodically check for idle bots
setInterval(() => {
  const now = Date.now();
  for (const [mmUserId, s] of Object.entries(botStatus)) {
    if (s.status !== 'idle' && (now - s.lastActivity) > BOT_IDLE_TIMEOUT_MS) {
      updateBotStatus(mmUserId, 'idle', null);
    }
  }
}, 30000);

// API: Get all bot statuses
app.get('/api/bots/status', (_req, res) => {
  const result = [];
  for (const [mmUserId, s] of Object.entries(botStatus)) {
    const bot = mmUserIdToAgentId[mmUserId];
    if (bot) {
      result.push({
        agent_id: bot.agent_id,
        mm_user_id: mmUserId,
        emoji: bot.emoji,
        name: bot.name,
        status: s.status,
        lastActivity: s.lastActivity,
        lastMessage: s.lastMessage,
      });
    }
  }
  res.json(result);
});
app.get('/api/ops/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':\n\n'); // comment to flush
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

/** Track a channel so we forward its messages via SSE */
function trackChannel(channelId) {
  trackedChannels.add(channelId);
}

// ── Mattermost WebSocket client (pure Node, no deps) ──

let mmWsAlive = false;
let mmWsReconnectTimer = null;
let mmWsSeq = 1;

function connectMmWebSocket() {
  const wsUrl = MM_BASE_URL.replace(/^http/, 'ws') + '/api/v4/websocket';
  const isSecure = wsUrl.startsWith('wss');
  const mod = isSecure ? https : http;
  const urlObj = new URL(wsUrl);

  const reqOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isSecure ? 443 : 80),
    path: urlObj.pathname,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('base64'),
    },
  };

  const req = mod.request(reqOptions);
  req.end();

  req.on('upgrade', (_res, socket) => {
    console.log('[MM-WS] Connected');
    mmWsAlive = true;

    // Authenticate
    const authMsg = JSON.stringify({ seq: mmWsSeq++, action: 'authentication_challenge', data: { token: PORTAL_OPS_TOKEN } });
    sendWsFrame(socket, authMsg);

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Parse WebSocket frames
      while (buffer.length >= 2) {
        const parsed = parseWsFrame(buffer);
        if (!parsed) break;
        buffer = parsed.rest;
        if (parsed.opcode === 0x1) { // text frame
          handleMmEvent(parsed.payload);
        } else if (parsed.opcode === 0x9) { // ping
          sendWsFrame(socket, '', 0xa); // pong
        } else if (parsed.opcode === 0x8) { // close
          console.log('[MM-WS] Server closed connection');
          socket.destroy();
          return;
        }
      }
    });

    socket.on('close', () => {
      console.log('[MM-WS] Disconnected');
      mmWsAlive = false;
      scheduleMmReconnect();
    });

    socket.on('error', (err) => {
      console.error('[MM-WS] Socket error:', err.message);
      mmWsAlive = false;
      socket.destroy();
      scheduleMmReconnect();
    });

    // Keep-alive ping every 30s
    const pingInterval = setInterval(() => {
      if (socket.destroyed) { clearInterval(pingInterval); return; }
      sendWsFrame(socket, '', 0x9);
    }, 30000);
  });

  req.on('error', (err) => {
    console.error('[MM-WS] Connection error:', err.message);
    scheduleMmReconnect();
  });
}

function scheduleMmReconnect() {
  if (mmWsReconnectTimer) return;
  mmWsReconnectTimer = setTimeout(() => {
    mmWsReconnectTimer = null;
    console.log('[MM-WS] Reconnecting...');
    connectMmWebSocket();
  }, 5000);
}

function handleMmEvent(text) {
  try {
    const evt = JSON.parse(text);

    // Track bot typing events
    if (evt.event === 'typing') {
      const userId = evt.data?.user_id || evt.broadcast?.user_id;
      if (userId && mmUserIdToAgentId[userId]) {
        updateBotStatus(userId, 'typing', null);
      }
    }

    if (evt.event === 'posted') {
      const post = JSON.parse(evt.data?.post ?? '{}');
      const channelId = post.channel_id;

      // Track bot posted events (bot just replied → active)
      if (post.user_id && mmUserIdToAgentId[post.user_id]) {
        const snippet = (post.message || '').slice(0, 100);
        updateBotStatus(post.user_id, 'active', snippet);
      }

      // Only forward posts from tracked channels and NOT from portalops itself
      if (channelId && trackedChannels.has(channelId) && post.user_id !== PORTAL_OPS_USER_ID) {
        broadcastSSE('new_message', {
          id: post.id,
          channel_id: channelId,
          user_id: post.user_id,
          message: post.message,
          create_at: post.create_at,
          update_at: post.update_at,
        });
      }
    }
  } catch {
    // ignore parse errors
  }
}

// ── Minimal WebSocket frame encoder/decoder (RFC 6455) ──

function sendWsFrame(socket, data, opcode = 0x1) {
  const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | len; // masked
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  // Mask key
  const maskOffset = header.length - 4;
  const mask = Buffer.from([Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256].map(Math.floor));
  mask.copy(header, maskOffset);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  socket.write(Buffer.concat([header, masked]));
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const isMasked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (isMasked) {
    if (buf.length < offset + 4 + payloadLen) return null;
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    const data = buf.slice(offset, offset + payloadLen);
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    return { opcode, payload: data.toString('utf8'), rest: buf.slice(offset + payloadLen) };
  }
  if (buf.length < offset + payloadLen) return null;
  const data = buf.slice(offset, offset + payloadLen);
  return { opcode, payload: data.toString('utf8'), rest: buf.slice(offset + payloadLen) };
}

// ── NBA (Next Best Action): Send message to bot by MM username ──
const NBA_ADMIN_TOKEN = MM_ADMIN_TOKEN;

app.post('/api/nba/send', async (req, res) => {
  try {
    const { target_bot, message } = req.body || {};
    if (!target_bot || !message) {
      return res.status(400).json({ error: '缺少 target_bot 或 message' });
    }

    // 1. Resolve MM username → user_id
    const userRes = await fetch(`${MM_BASE_URL}/api/v4/users/username/${encodeURIComponent(target_bot)}`, {
      headers: { Authorization: `Bearer ${NBA_ADMIN_TOKEN}` },
    });
    if (!userRes.ok) {
      const err = await userRes.text();
      return res.status(404).json({ error: `找不到用户 @${target_bot}: ${err.slice(0, 200)}` });
    }
    const user = await userRes.json();
    const targetUserId = user.id;

    // 2. Create / get DM channel between admin bot and target
    const channelRes = await fetch(`${MM_BASE_URL}/api/v4/channels/direct`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NBA_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([PORTAL_OPS_USER_ID, targetUserId]),
    });
    if (!channelRes.ok) {
      const err = await channelRes.text();
      return res.status(502).json({ error: `创建 DM 频道失败: ${err.slice(0, 200)}` });
    }
    const channel = await channelRes.json();

    // 3. Post message
    const postRes = await fetch(`${MM_BASE_URL}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NBA_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel_id: channel.id, message }),
    });
    if (!postRes.ok) {
      const err = await postRes.text();
      return res.status(502).json({ error: `发送消息失败: ${err.slice(0, 200)}` });
    }
    const post = await postRes.json();

    res.json({ ok: true, post_id: post.id, channel_id: channel.id, target_user_id: targetUserId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── AP_projects v2 (auto-tracked project status layer) ──
// Data lives in AP_projects table; metadata jsonb contains involved_bots, milestones, etc.
// We flatten metadata into top-level fields for the frontend.

// Helper: safely convert date to YYYY-MM-DD string (handles Date objects from PG and strings from Supabase REST)
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.slice(0, 10);
  return null;
}

function flattenAPProject(row) {
  const m = row.metadata || {};
  // Derive health from status if not explicitly set
  const statusVal = row.status === 'completed' ? 'done' : (row.status || 'discovering');
  const healthMap = { active: 'healthy', blocked: 'blocked', discovering: 'healthy', dormant: 'stale', done: 'healthy', dismissed: 'stale' };
  // Derive current_summary from latest milestone if not set
  const milestones = m.milestones || [];
  const sortedMilestones = [...milestones].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestMilestone = sortedMilestones[0];
  // Derive recent_events from last 5 milestones
  const recentEvents = (m.recent_events || sortedMilestones.slice(0, 5)).map(e =>
    typeof e === 'string' ? { date: null, event: e } : e
  );
  const nextActions = Array.isArray(m.next_actions)
    ? m.next_actions.map(a => typeof a === 'string' ? { text: a } : a)
    : [];

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: statusVal,
    health: m.health || healthMap[statusVal] || 'healthy',
    current_summary: m.current_summary || (latestMilestone ? latestMilestone.event : row.description) || null,
    responsible_bot: m.responsible_bot || m.primary_bot || row.agent_id || null,
    recent_events: recentEvents,
    last_updated: m.last_updated || m.last_active || toDateStr(row.updated_at),
    first_seen: m.first_seen || toDateStr(row.created_at),
    last_active: m.last_active || toDateStr(row.updated_at),
    involved_bots: m.involved_bots || [],
    primary_bot: m.primary_bot || row.agent_id || null,
    milestones: milestones,
    next_actions: nextActions,
    deliverables: Array.isArray(m.deliverables)
      ? m.deliverables.map(d => typeof d === 'string' ? { name: d } : d)
      : [],
    tags: row.tags || [],
    user_notes: m.user_notes || null,
    auto_generated: m.auto_generated ?? true,
    merged_into: m.merged_into || null,
    emoji: row.emoji || null,
    maintainers: Array.isArray(m.maintainers) ? m.maintainers : null,
    metadata: { sort_order: m.sort_order ?? null },
  };
}

// Slim version for list endpoint — only fields needed by ProjectKanbanTab
function flattenAPProjectSlim(row) {
  const m = row.metadata || {};
  const statusVal = row.status === 'completed' ? 'done' : (row.status || 'discovering');
  const healthMap = { active: 'healthy', blocked: 'blocked', discovering: 'healthy', dormant: 'stale', done: 'healthy', dismissed: 'stale' };
  const milestones = m.milestones || [];
  const sortedMilestones = [...milestones].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestMilestone = sortedMilestones[0];
  const nextActions = Array.isArray(m.next_actions)
    ? m.next_actions.slice(0, 3).map(a => typeof a === 'string' ? { text: a } : a)
    : [];

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: statusVal,
    emoji: row.emoji || null,
    health: m.health || healthMap[statusVal] || 'healthy',
    current_summary: m.current_summary || (latestMilestone ? latestMilestone.event : row.description) || null,
    responsible_bot: m.responsible_bot || m.primary_bot || row.agent_id || null,
    involved_bots: m.involved_bots || [],
    primary_bot: m.primary_bot || row.agent_id || null,
    next_actions: nextActions,
    last_active: m.last_active || toDateStr(row.updated_at),
    merged_into: m.merged_into || null,
    maintainers: Array.isArray(m.maintainers) ? m.maintainers : null,
    metadata: { sort_order: m.sort_order ?? null },
  };
}

app.get('/api/ap-projects', async (req, res) => {
  try {
    const { status, bot, tag, include_dismissed } = req.query;
    const rows = await dbQuery(`
      SELECT id, name, slug, description, status, tags, agent_id, metadata,
             emoji, created_at, updated_at
      FROM "AP_projects"
      ORDER BY updated_at DESC NULLS LAST
    `);
    let projects = rows.map(flattenAPProjectSlim);

    // Default: exclude dismissed unless explicitly requested
    if (include_dismissed !== 'true') {
      projects = projects.filter(p => p.status !== 'dismissed');
    }

    // Apply filters
    if (status) projects = projects.filter(p => p.status === status);
    if (bot) projects = projects.filter(p => p.involved_bots.includes(bot));

    // Sort by status priority then last_active
    const ORDER = { active: 1, blocked: 2, discovering: 3, dormant: 4, done: 5, dismissed: 6 };
    projects.sort((a, b) => (ORDER[a.status] ?? 7) - (ORDER[b.status] ?? 7) || (b.last_active ?? '').localeCompare(a.last_active ?? ''));

    res.json(projects);
  } catch (e) {
    console.error('[ap-projects] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ap-projects/:id', async (req, res) => {
  try {
    const rows = await dbQuery(`
      SELECT id, name, slug, description, status, tags, agent_id, metadata,
             emoji, created_at, updated_at
      FROM "AP_projects"
      WHERE id = '${esc(req.params.id)}'
      LIMIT 1
    `);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json(flattenAPProject(rows[0]));
  } catch (e) {
    console.error('[ap-projects] get error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/ap-projects/:id', async (req, res) => {
  try {
    const { status, user_notes, name, description } = req.body;
    // Read current row
    const rows = await dbQuery(`SELECT metadata FROM "AP_projects" WHERE id = '${esc(req.params.id)}' LIMIT 1`);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    const meta = rows[0].metadata || {};

    const sets = [];
    if (status) {
      const dbStatus = status === 'done' ? 'completed' : status;
      sets.push(`status = '${esc(dbStatus)}'`);
    }
    if (name !== undefined) {
      sets.push(`name = '${esc(name)}'`);
      const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
      sets.push(`slug = '${esc(slug)}'`);
    }
    if (description !== undefined) {
      sets.push(`description = '${esc(description)}'`);
    }
    if (user_notes !== undefined) {
      meta.user_notes = user_notes;
      sets.push(`metadata = '${esc(JSON.stringify(meta))}'::jsonb`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = NOW()`);
    await dbExec(`UPDATE "AP_projects" SET ${sets.join(', ')} WHERE id = '${esc(req.params.id)}'`);
    // Return updated
    const updated = await dbQuery(`SELECT id, name, slug, description, status, tags, agent_id, metadata, emoji, created_at, updated_at FROM "AP_projects" WHERE id = '${esc(req.params.id)}' LIMIT 1`);
    res.json(flattenAPProject(updated[0]));
  } catch (e) {
    console.error('[ap-projects] patch error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── LLM helper for project merge ──
async function callLLM(prompt) {
  const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  // Azure endpoint format
  const url = apiBase.includes('azure.com')
    ? `${apiBase}/openai/deployments/${model}/chat/completions?api-version=2024-12-01-preview`
    : `${apiBase}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiBase.includes('azure.com')) headers['api-key'] = apiKey;
  else headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: '你是项目管理助手，输出纯 JSON，不要 markdown 包裹。' }, { role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

// ── Deep project merge ──
app.post('/api/project-merge', async (req, res) => {
  try {
    const { main_id, merge_id } = req.body;
    if (!main_id || !merge_id) return res.status(400).json({ error: 'main_id and merge_id required' });
    if (main_id === merge_id) return res.status(400).json({ error: 'Cannot merge a project into itself' });

    const mainRows = await dbQuery(`SELECT * FROM "AP_projects" WHERE id = '${esc(main_id)}' LIMIT 1`);
    if (!mainRows.length) return res.status(404).json({ error: 'Main project not found' });
    const mergeRows = await dbQuery(`SELECT * FROM "AP_projects" WHERE id = '${esc(merge_id)}' LIMIT 1`);
    if (!mergeRows.length) return res.status(404).json({ error: 'Merge project not found' });

    const mainRow = mainRows[0], mergeRow = mergeRows[0];
    const mainMeta = mainRow.metadata || {}, mergeMeta = mergeRow.metadata || {};

    // Step 1: Deep data merge
    // Milestones: combine, sort by date, deduplicate by event text
    const allMilestones = [...(mainMeta.milestones || []), ...(mergeMeta.milestones || [])];
    const seen = new Set();
    const mergedMilestones = allMilestones
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .filter(m => { const k = `${m.date}|${m.event}`; if (seen.has(k)) return false; seen.add(k); return true; });

    // Involved bots: union
    const mergedBots = [...new Set([...(mainMeta.involved_bots || []), ...(mergeMeta.involved_bots || [])])];

    // Recent events: combine, sort, keep last 20
    const allEvents = [...(mainMeta.recent_events || []), ...(mergeMeta.recent_events || [])];
    const mergedEvents = allEvents
      .sort((a, b) => ((b.date || '').localeCompare(a.date || '')))
      .slice(0, 20);

    // Deliverables: combine, deduplicate by name
    const allDeliverables = [...(mainMeta.deliverables || []), ...(mergeMeta.deliverables || [])];
    const delNames = new Set();
    const mergedDeliverables = allDeliverables.filter(d => {
      const k = d.name || d.url || JSON.stringify(d);
      if (delNames.has(k)) return false; delNames.add(k); return true;
    });

    // first_seen: earlier; last_active: later
    const firstSeen = [mainMeta.first_seen, mergeMeta.first_seen].filter(Boolean).sort()[0] || null;
    const lastActive = [mainMeta.last_active, mergeMeta.last_active].filter(Boolean).sort().pop() || null;

    // Tags: union
    const mergedTags = [...new Set([...(mainRow.tags || []), ...(mergeRow.tags || [])])];

    // Step 2: LLM re-analysis
    let llmResult = {};
    try {
      const prompt = `以下两个项目需要合并为一个：

项目A（主项目）: ${mainRow.name}
描述: ${mainRow.description || '无'}
里程碑: ${JSON.stringify(mergedMilestones.slice(-10).map(m => `${m.date}: ${m.event}`))}

项目B（被合并项目）: ${mergeRow.name}
描述: ${mergeRow.description || '无'}
里程碑: ${JSON.stringify((mergeMeta.milestones || []).slice(-10).map(m => `${m.date}: ${m.event}`))}

请生成合并后的项目信息，返回纯 JSON：
{
  "description": "一句话描述合并后的项目目标",
  "current_summary": "当前状态总结（一句话）",
  "next_action": "下一步建议",
  "tags": ["标签1", "标签2"]
}`;
      llmResult = await callLLM(prompt);
      console.log('[project-merge] LLM result:', JSON.stringify(llmResult));
    } catch (llmErr) {
      console.error('[project-merge] LLM failed, using fallback:', llmErr.message);
      llmResult = {
        description: mainRow.description || mergeRow.description,
        current_summary: mainMeta.current_summary || mergeMeta.current_summary,
        next_action: (mainMeta.next_actions?.[0]?.text) || (mergeMeta.next_actions?.[0]?.text) || null,
        tags: mergedTags,
      };
    }

    // Step 3: Write to DB
    const updatedMeta = {
      ...mainMeta,
      milestones: mergedMilestones,
      involved_bots: mergedBots,
      recent_events: mergedEvents,
      deliverables: mergedDeliverables,
      first_seen: firstSeen,
      last_active: lastActive,
      current_summary: llmResult.current_summary || mainMeta.current_summary,
      next_actions: llmResult.next_action
        ? [{ text: llmResult.next_action, done: false }, ...(mainMeta.next_actions || []).filter(a => a.done)]
        : mainMeta.next_actions || [],
      merged_from: [...(mainMeta.merged_from || []), { id: merge_id, name: mergeRow.name, date: new Date().toISOString().slice(0, 10) }],
    };

    const newDesc = llmResult.description || mainRow.description || mergeRow.description || '';
    const newTags = llmResult.tags && Array.isArray(llmResult.tags) ? llmResult.tags : mergedTags;

    await dbExec(`UPDATE "AP_projects" SET
      description = '${esc(newDesc)}',
      tags = ARRAY[${newTags.map(t => `'${esc(t)}'`).join(',')}]::text[],
      metadata = '${esc(JSON.stringify(updatedMeta))}'::jsonb,
      updated_at = NOW()
      WHERE id = '${esc(main_id)}'`);

    // Mark merge source as dismissed
    const srcMeta = { ...mergeMeta, merged_into: main_id };
    await dbExec(`UPDATE "AP_projects" SET status = 'dismissed', metadata = '${esc(JSON.stringify(srcMeta))}'::jsonb, updated_at = NOW() WHERE id = '${esc(merge_id)}'`);

    // Return updated main project
    const updated = await dbQuery(`SELECT id, name, slug, description, status, tags, agent_id, metadata, emoji, created_at, updated_at FROM "AP_projects" WHERE id = '${esc(main_id)}' LIMIT 1`);
    res.json({ success: true, updated_project: flattenAPProject(updated[0]) });
  } catch (e) {
    console.error('[project-merge] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Legacy merge endpoint (redirects to new)
app.post('/api/ap-projects/:id/merge', async (req, res) => {
  req.body.main_id = req.body.target_id;
  req.body.merge_id = req.params.id;
  // Forward to new endpoint handler
  try {
    const { target_id } = req.body;
    if (!target_id) return res.status(400).json({ error: 'target_id required' });
    // Redirect logic: main = target, merge = source (this endpoint)
    const resp = await fetch(`http://localhost:${PORT}/api/project-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main_id: target_id, merge_id: req.params.id }),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (e) {
    console.error('[ap-projects] legacy merge error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ap-projects', async (req, res) => {
  try {
    const { name, description, status, primary_bot, involved_bots, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
    const meta = {
      auto_generated: false,
      first_seen: new Date().toISOString().slice(0, 10),
      last_active: new Date().toISOString().slice(0, 10),
      involved_bots: involved_bots || [],
      primary_bot: primary_bot || null,
      milestones: [],
      next_actions: [],
      deliverables: [],
    };
    const id = require('crypto').randomUUID();
    await dbExec(`
      INSERT INTO "AP_projects" (id, name, slug, description, status, tags, agent_id, metadata)
      VALUES (
        '${id}', '${esc(name)}', '${esc(slug)}', '${esc(description || '')}',
        '${esc(status === 'done' ? 'completed' : (status || 'active'))}',
        ${tags ? `ARRAY[${tags.map(t => `'${esc(t)}'`).join(',')}]::text[]` : 'ARRAY[]::text[]'},
        ${primary_bot ? `'${esc(primary_bot)}'` : 'NULL'},
        '${esc(JSON.stringify(meta))}'::jsonb
      )
    `);
    const rows = await dbQuery(`SELECT id, name, slug, description, status, tags, agent_id, metadata, emoji, created_at, updated_at FROM "AP_projects" WHERE id = '${id}' LIMIT 1`);
    res.json(flattenAPProject(rows[0] || { id, name, metadata: meta }));
  } catch (e) {
    console.error('[ap-projects] create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Send message to bot's DM channel (continue conversation) ──
app.post('/api/ap-projects/:id/message', async (req, res) => {
  try {
    const { message, bot_id } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Resolve bot agent_id → MM username → MM user_id
    const AGENT_ID_MAP = {
      'rabbit': 'ottor-pc-cloud-bot', 'clawline-channel': 'channelbot',
      'codebot': 'codebot', 'dora-kids': 'dora-kids', 'fox-claude': 'fox',
      'giraffe': 'giraffe', 'koala': 'koala', 'miss-e': 'miss-e',
      'owl': 'owl', 'panda': 'panda', 'penguin': 'penguin-bot',
      'phoenix': 'phoenix', 'puppy': 'puppy', 'research': 'research',
      'research-portal': 'portalbot', 'seal-whisper': 'seal-whisper',
      'tiger-claw': 'tiger', 'whale': 'whale', 'wolf': 'wolf',
    };

    // Find the bot
    let agentId = bot_id;
    if (!agentId) {
      // Look up from project data
      const rows = await dbQuery(`SELECT metadata, agent_id FROM "AP_projects" WHERE id = '${esc(req.params.id)}' LIMIT 1`);
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      const m = rows[0].metadata || {};
      agentId = m.responsible_bot || m.primary_bot || rows[0].agent_id;
    }
    if (!agentId) return res.status(400).json({ error: 'No bot associated with this project' });

    const mmUsername = AGENT_ID_MAP[agentId] || agentId;

    // Get bot's MM user_id
    const botUserRes = await fetch(`${MM_BASE_URL}/api/v4/users/username/${mmUsername}`, {
      headers: { Authorization: `Bearer ${MM_ADMIN_TOKEN}` },
    });
    if (!botUserRes.ok) return res.status(404).json({ error: `Bot ${mmUsername} not found on Mattermost` });
    const botUser = await botUserRes.json();

    // Create/get DM channel between @dora and the bot
    const dmRes = await fetch(`${MM_BASE_URL}/api/v4/channels/direct`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MM_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([MM_ADMIN_USER_ID, botUser.id]),
    });
    if (!dmRes.ok) return res.status(500).json({ error: 'Failed to create DM channel' });
    const dmChannel = await dmRes.json();

    // Send message as @dora
    const msgRes = await fetch(`${MM_BASE_URL}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MM_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: dmChannel.id,
        message: message,
      }),
    });
    if (!msgRes.ok) return res.status(500).json({ error: 'Failed to send message' });

    const post = await msgRes.json();
    res.json({ ok: true, post_id: post.id, channel_id: dmChannel.id, bot: mmUsername });
  } catch (e) {
    console.error('[ap-projects] message error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Project Action (approve / reject) ──
app.post('/api/project-action', async (req, res) => {
  try {
    const { project_id, action, reason, next_action } = req.body;
    if (!project_id || !action) return res.status(400).json({ error: 'project_id and action required' });
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

    // Ensure AP_project_actions table exists
    await dbExec(`
      CREATE TABLE IF NOT EXISTS "AP_project_actions" (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        project_id uuid REFERENCES "AP_projects"(id),
        action text NOT NULL,
        next_action text,
        reason text,
        created_at timestamptz DEFAULT now()
      )
    `);

    // Record the action
    await dbExec(`
      INSERT INTO "AP_project_actions" (project_id, action, next_action, reason)
      VALUES ('${esc(project_id)}', '${esc(action)}', '${esc(next_action || '')}', '${esc(reason || '')}')
    `);

    // Look up responsible bot
    const rows = await dbQuery(`SELECT metadata, agent_id, name FROM "AP_projects" WHERE id = '${esc(project_id)}' LIMIT 1`);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    const project = rows[0];
    const m = project.metadata || {};
    const agentId = m.responsible_bot || m.primary_bot || project.agent_id;

    // Build message
    let mmMessage;
    if (action === 'approve') {
      mmMessage = `Daddy 已批准执行：${next_action || '(无具体操作)'}。请立即开始。`;
    } else {
      mmMessage = `Daddy 已驳回操作「${next_action || '(无具体操作)'}」。原因：${reason || '未提供'}。请暂停并等待进一步指示。`;
    }

    // Update project health
    const newHealth = action === 'approve' ? 'healthy' : 'attention';
    await dbExec(`
      UPDATE "AP_projects" SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{health}',
        '"${newHealth}"'
      ), updated_at = now()
      WHERE id = '${esc(project_id)}'
    `);

    // Send message to bot via Mattermost (best-effort)
    let messageSent = false;
    if (agentId) {
      const AGENT_ID_MAP = {
        'rabbit': 'ottor-pc-cloud-bot', 'clawline-channel': 'channelbot',
        'codebot': 'codebot', 'dora-kids': 'dora-kids', 'fox-claude': 'fox',
        'giraffe': 'giraffe', 'koala': 'koala', 'miss-e': 'miss-e',
        'owl': 'owl', 'panda': 'panda', 'penguin': 'penguin-bot',
        'phoenix': 'phoenix', 'puppy': 'puppy', 'research': 'research',
        'research-portal': 'portalbot', 'seal-whisper': 'seal-whisper',
        'tiger-claw': 'tiger', 'whale': 'whale', 'wolf': 'wolf',
      };
      const mmUsername = AGENT_ID_MAP[agentId] || agentId;
      try {
        // Get bot MM user
        const botUserRes = await fetch(`${MM_BASE_URL}/api/v4/users/username/${mmUsername}`, {
          headers: { Authorization: `Bearer ${MM_ADMIN_TOKEN}` },
        });
        if (botUserRes.ok) {
          const botUser = await botUserRes.json();
          // Create/get DM channel
          const dmRes = await fetch(`${MM_BASE_URL}/api/v4/channels/direct`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${MM_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([MM_ADMIN_USER_ID, botUser.id]),
          });
          if (dmRes.ok) {
            const dm = await dmRes.json();
            const msgRes = await fetch(`${MM_BASE_URL}/api/v4/posts`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${MM_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ channel_id: dm.id, message: mmMessage }),
            });
            messageSent = msgRes.ok;
          }
        }
      } catch (mmErr) {
        console.error('[project-action] MM send error:', mmErr.message);
      }
    }

    res.json({
      ok: true,
      action,
      project_id,
      new_health: newHealth,
      message_sent: messageSent,
      bot: agentId || null,
    });
  } catch (e) {
    console.error('[project-action] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Project Chat: send message to rabbit DM channel via Mattermost ──
app.post('/api/project-chat', async (req, res) => {
  try {
    const { project_name, message } = req.body;
    if (!project_name || !message) return res.status(400).json({ error: 'project_name and message required' });

    const MM_URL = 'https://mm.dora.restry.cn/api/v4';
    const MM_TOKEN = 'ygw5qt86hi8p3r917j7khe3ogc';
    const RABBIT_DM_CHANNEL = 'um96ezb8z7fdd8rxwikeuygryc';

    const fullMessage = `[项目: ${project_name}] ${message}`;

    const mmResp = await fetch(`${MM_URL}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MM_TOKEN}` },
      body: JSON.stringify({ channel_id: RABBIT_DM_CHANNEL, message: fullMessage }),
    });

    if (!mmResp.ok) {
      const errTxt = await mmResp.text();
      console.error('[project-chat] MM error:', mmResp.status, errTxt);
      return res.status(502).json({ error: 'Failed to send to Mattermost', detail: errTxt.slice(0, 200) });
    }

    const post = await mmResp.json();
    console.log('[project-chat] sent:', fullMessage.slice(0, 80), 'post_id:', post.id);
    res.json({ ok: true, post_id: post.id, message: fullMessage });
  } catch (e) {
    console.error('[project-chat] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Digest Refresh (via Mattermost DM to rabbit bot) ──
const RABBIT_CHANNEL_ID = 'um96ezb8z7fdd8rxwikeuygryc';

app.post('/api/digest/refresh', async (req, res) => {
  try {
    const msgRes = await fetch(`${MM_BASE_URL}/api/v4/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MM_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: RABBIT_CHANNEL_ID,
        message: '[系统] 门户触发数据刷新',
      }),
    });
    if (!msgRes.ok) {
      const err = await msgRes.text();
      console.error('[digest/refresh] MM post failed:', msgRes.status, err);
      return res.status(502).json({ ok: false, message: '发送触发消息失败' });
    }
    console.log('[digest/refresh] triggered via MM DM to rabbit');
    res.status(202).json({ ok: true, message: '已触发刷新，预计 1-3 分钟后数据更新' });
  } catch (e) {
    console.error('[digest/refresh] error:', e);
    res.status(500).json({ ok: false, message: '触发失败: ' + e.message });
  }
});

// ── Project Sort Order (via metadata JSONB) ──
app.put('/api/ap-projects/sort-order', async (req, res) => {
  try {
    const { orders } = req.body || {};
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ ok: false, error: 'orders array required' });
    }
    // Update metadata.sort_order for each project
    const updates = orders.map(({ id, sort_order }) =>
      dbExec(`UPDATE "AP_projects" SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sort_order', ${parseInt(sort_order, 10) || 0}) WHERE id = '${esc(id)}'`)
    );
    await Promise.all(updates);
    console.log(`[sort-order] updated ${orders.length} projects via metadata`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[sort-order] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Patch /api/ops/send to auto-track channel ──
const origSendHandler = app._router?.stack; // we'll patch inline instead

// ══════════════════════════════════════════════════════════════════
// ── Health Monitoring API ──
// ══════════════════════════════════════════════════════════════════

// GET /api/monitors — list monitors with optional filters
app.get('/api/monitors', async (req, res) => {
  try {
    const { type, group, enabled } = req.query;
    let where = [];
    if (type) where.push(`type = '${esc(type)}'`);
    if (group) where.push(`group_name = '${esc(group)}'`);
    if (enabled !== undefined) where.push(`enabled = ${enabled === 'true'}`);
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await dbQuery(`SELECT * FROM "AP_monitors" ${whereClause} ORDER BY group_name, name`);
    res.json(rows ?? []);
  } catch (e) {
    console.error('[monitors] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/monitors — create new monitor
app.post('/api/monitors', async (req, res) => {
  try {
    const { name, type = 'http', target, interval_sec = 300, timeout_ms = 5000, expected_status = 200, keyword, project_slug, group_name = '其他' } = req.body || {};
    if (!name || !target) {
      return res.status(400).json({ error: 'name and target required' });
    }
    const rows = await dbQuery(`
      INSERT INTO "AP_monitors" (name, type, target, interval_sec, timeout_ms, expected_status, keyword, project_slug, group_name)
      VALUES ('${esc(name)}', '${esc(type)}', '${esc(target)}', ${parseInt(interval_sec, 10)}, ${parseInt(timeout_ms, 10)}, ${parseInt(expected_status, 10)}, ${keyword ? `'${esc(keyword)}'` : 'NULL'}, ${project_slug ? `'${esc(project_slug)}'` : 'NULL'}, '${esc(group_name)}')
      RETURNING *
    `);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[monitors] create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/monitors/:id — update monitor
app.put('/api/monitors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, target, interval_sec, timeout_ms, expected_status, keyword, project_slug, group_name, enabled, paused } = req.body || {};
    const sets = [];
    if (name !== undefined) sets.push(`name = '${esc(name)}'`);
    if (type !== undefined) sets.push(`type = '${esc(type)}'`);
    if (target !== undefined) sets.push(`target = '${esc(target)}'`);
    if (interval_sec !== undefined) sets.push(`interval_sec = ${parseInt(interval_sec, 10)}`);
    if (timeout_ms !== undefined) sets.push(`timeout_ms = ${parseInt(timeout_ms, 10)}`);
    if (expected_status !== undefined) sets.push(`expected_status = ${parseInt(expected_status, 10)}`);
    if (keyword !== undefined) sets.push(`keyword = ${keyword ? `'${esc(keyword)}'` : 'NULL'}`);
    if (project_slug !== undefined) sets.push(`project_slug = ${project_slug ? `'${esc(project_slug)}'` : 'NULL'}`);
    if (group_name !== undefined) sets.push(`group_name = '${esc(group_name)}'`);
    if (enabled !== undefined) sets.push(`enabled = ${!!enabled}`);
    if (paused !== undefined) sets.push(`paused = ${!!paused}`);
    sets.push(`updated_at = now()`);
    const rows = await dbQuery(`UPDATE "AP_monitors" SET ${sets.join(', ')} WHERE id = ${parseInt(id, 10)} RETURNING *`);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Monitor not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[monitors] update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/monitors/:id
app.delete('/api/monitors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbExec(`DELETE FROM "AP_monitors" WHERE id = ${parseInt(id, 10)}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[monitors] delete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/monitors/:id/toggle — toggle enabled/paused
app.post('/api/monitors/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await dbQuery(`
      UPDATE "AP_monitors" SET enabled = NOT enabled, updated_at = now()
      WHERE id = ${parseInt(id, 10)} RETURNING enabled
    `);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Monitor not found' });
    res.json({ ok: true, enabled: rows[0].enabled });
  } catch (e) {
    console.error('[monitors] toggle error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/monitors/uptime — uptime stats for all monitors
app.get('/api/monitors/uptime', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const rows = await dbQuery(`
      SELECT 
        m.id as monitor_id, m.name, m.group_name, m.target, m.expected_status,
        COALESCE(ROUND(count(*) FILTER (WHERE s.http_status = m.expected_status) * 100.0 / NULLIF(count(s.*), 0), 2), 100) as uptime_pct,
        ROUND(avg(s.response_ms)::numeric, 0) as avg_response_ms,
        (SELECT http_status FROM "AP_site_checks" WHERE name = m.name AND kind = (CASE WHEN m.group_name = '生产环境' THEN 'production' ELSE 'dev' END) ORDER BY snapshot_time DESC LIMIT 1) as last_status,
        (SELECT snapshot_time FROM "AP_site_checks" WHERE name = m.name AND kind = (CASE WHEN m.group_name = '生产环境' THEN 'production' ELSE 'dev' END) ORDER BY snapshot_time DESC LIMIT 1) as last_checked,
        count(s.*) FILTER (WHERE s.snapshot_time > now() - interval '24 hours') as checks_24h,
        count(s.*) FILTER (WHERE s.snapshot_time > now() - interval '24 hours' AND s.http_status != m.expected_status) as fails_24h
      FROM "AP_monitors" m
      LEFT JOIN "AP_site_checks" s ON s.name = m.name 
        AND s.kind = (CASE WHEN m.group_name = '生产环境' THEN 'production' ELSE 'dev' END)
        AND s.snapshot_time > now() - interval '${days} days'
      WHERE m.enabled = true
      GROUP BY m.id, m.name, m.group_name, m.target, m.expected_status
      ORDER BY m.group_name, m.name
    `);
    res.json(rows ?? []);
  } catch (e) {
    console.error('[monitors/uptime] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/monitors/:id/history — check history for a specific monitor
app.get('/api/monitors/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const hours = parseInt(req.query.hours, 10) || 24;
    // First get the monitor to determine kind
    const monitors = await dbQuery(`SELECT * FROM "AP_monitors" WHERE id = ${parseInt(id, 10)}`);
    if (!monitors || monitors.length === 0) return res.status(404).json({ error: 'Monitor not found' });
    const m = monitors[0];
    const kind = m.group_name === '生产环境' ? 'production' : 'dev';
    const rows = await dbQuery(`
      SELECT snapshot_time, http_status, response_ms
      FROM "AP_site_checks"
      WHERE name = '${esc(m.name)}' AND kind = '${kind}'
        AND snapshot_time > now() - interval '${hours} hours'
      ORDER BY snapshot_time ASC
    `);
    res.json(rows ?? []);
  } catch (e) {
    console.error('[monitors/:id/history] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/incidents — list incidents
app.get('/api/incidents', async (req, res) => {
  try {
    const { monitor_id, limit = 50, resolved } = req.query;
    let where = [];
    if (monitor_id) where.push(`i.monitor_id = ${parseInt(monitor_id, 10)}`);
    if (resolved === 'true') where.push(`i.resolved_at IS NOT NULL`);
    if (resolved === 'false') where.push(`i.resolved_at IS NULL`);
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await dbQuery(`
      SELECT i.*, m.name as monitor_name
      FROM "AP_incidents" i
      LEFT JOIN "AP_monitors" m ON m.id = i.monitor_id
      ${whereClause}
      ORDER BY i.started_at DESC
      LIMIT ${parseInt(limit, 10)}
    `);
    res.json(rows ?? []);
  } catch (e) {
    console.error('[incidents] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback: serve index.html for all non-API routes
const _spaIndexPath = path.resolve(__dirname, 'dist', 'index.html');
const _spaIndexHtml = require('fs').readFileSync(_spaIndexPath, 'utf-8');
app.get('{*path}', (req, res) => {
  res.type('html').send(_spaIndexHtml);
});

app.listen(PORT, () => {
  console.log(`Agent Portal running on http://localhost:${PORT}`);
  console.log(`Database: ${pool ? 'PostgreSQL direct ✅' : 'Supabase REST (legacy)'}`);
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);

  // Initial sync after 3 seconds, then every SYNC_INTERVAL_MS
  setTimeout(() => {
    syncWorkspaceOnce();
    setInterval(syncWorkspaceOnce, SYNC_INTERVAL_MS);
  }, 3000);

  // Connect to Mattermost WebSocket
  connectMmWebSocket();

  // Load bot status map for real-time tracking
  loadBotStatusMap();
});
