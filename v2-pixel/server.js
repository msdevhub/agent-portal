const express = require('express');
const path = require('path');

const app = express();
const PORT = 18820;
const MIME_TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const SUPABASE_URL = 'https://db.dora.restry.cn';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

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

const STATIC_ROOT = process.env.STATIC_DIR || path.join(__dirname, 'public');
app.use(express.json());
app.use(express.static(STATIC_ROOT));

async function dbQuery(sql) {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
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
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS "AP_projects" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        stage TEXT DEFAULT 'question',
        status TEXT DEFAULT 'active',
        emoji TEXT DEFAULT '🔬',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbQuery(`
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

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS "AP_notes" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'finding',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbQuery(`
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

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS "AP_timeline" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES "AP_projects"(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await dbQuery(`CREATE INDEX IF NOT EXISTS "AP_tasks_project_id_idx" ON "AP_tasks"(project_id);`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS "AP_notes_project_id_idx" ON "AP_notes"(project_id);`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS "AP_artifacts_project_id_idx" ON "AP_artifacts"(project_id);`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS "AP_timeline_project_id_idx" ON "AP_timeline"(project_id, created_at);`);

    res.json({ ok: true, message: 'Tables created' });
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
app.get('/api/doc/:slug/*', (req, res) => {
  const slug = req.params.slug;
  const docPath = req.params[0] || '';
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
app.put('/api/doc/:slug/*', (req, res) => {
  const slug = req.params.slug;
  const docPath = req.params[0] || '';
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
app.get('/api/workspace/*', (req, res) => {
  const filePath = (req.params[0] || '').replace(/\.\./g, '');
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
app.put('/api/workspace/*', (req, res) => {
  const filePath = (req.params[0] || '').replace(/\.\./g, '');
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

app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Agent Portal (Pixel) running on http://localhost:${PORT}`);
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);

  // Initial sync after 3 seconds, then every SYNC_INTERVAL_MS
  setTimeout(() => {
    syncWorkspaceOnce();
    setInterval(syncWorkspaceOnce, SYNC_INTERVAL_MS);
  }, 3000);
});
