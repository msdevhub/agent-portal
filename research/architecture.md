# Agent Portal — 系统方案设计

## 1. 产品定位

**Agent 研究项目管理平台** — 让爸爸（和未来其他用户）可以通过网页查看、管理 AI Agent 的所有研究项目。

核心价值：
- 📊 **项目全景** — 一眼看到所有项目的状态和进度
- 📝 **任务追踪** — 每个项目的任务队列、阶段流转
- 📄 **研究输出** — 查看文献综述、架构设计、POC 结果等研究文档
- 🔔 **动态更新** — Agent 完成工作后自动更新状态

---

## 2. 功能规划（MVP）

### P0 — 核心功能（MVP 第一版）

| 功能 | 描述 |
|:---|:---|
| **项目列表** | 展示所有研究项目，按状态/时间排序，卡片式布局 |
| **项目详情** | 查看项目 CONTEXT、任务列表、研究阶段进度条 |
| **任务管理** | 查看/编辑任务状态（pending → in_progress → done） |
| **新增项目** | 创建新研究项目（名称、描述、标签） |
| **研究阶段可视化** | 提问 → 文献调研 → 假设 → POC → 结论 → 报告 |

### P1 — 增强功能（后续迭代）

| 功能 | 描述 |
|:---|:---|
| **研究文档查看** | 在线查看 Markdown 研究文档 |
| **Agent 活动日志** | 查看 Agent 的工作记录/心跳 |
| **通知集成** | 项目状态变更时通知到 Mattermost |
| **多 Agent 支持** | 管理多个 Agent 的项目 |
| **数据统计** | 项目完成率、平均周期等统计图表 |

---

## 3. 数据模型

所有表使用前缀 `AP_`（Agent Portal）。

### `AP_projects` — 研究项目

```sql
CREATE TABLE AP_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,                          -- 项目名称
  slug TEXT UNIQUE NOT NULL,                   -- URL 友好标识 (如 "agentic-bi")
  description TEXT,                            -- 项目简介
  status TEXT NOT NULL DEFAULT 'active',       -- active | completed | paused | archived
  stage TEXT NOT NULL DEFAULT 'question',      -- question | literature | hypothesis | poc | conclusion | report
  tags TEXT[] DEFAULT '{}',                    -- 标签 (如 ["AI", "保险", "BI"])
  agent_id TEXT DEFAULT 'ottor',               -- 所属 Agent
  metadata JSONB DEFAULT '{}',                 -- 扩展元数据
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### `AP_tasks` — 任务队列

```sql
CREATE TABLE AP_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES AP_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                         -- 任务标题
  description TEXT,                            -- 任务详情
  stage TEXT NOT NULL,                         -- 所属研究阶段
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | in_progress | done | blocked
  priority INTEGER DEFAULT 0,                 -- 优先级 (0=普通, 1=高, 2=紧急)
  notes TEXT,                                  -- 进展备注
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### `AP_documents` — 研究文档（P1）

```sql
CREATE TABLE AP_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES AP_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'note',       -- note | literature_review | architecture | report
  content TEXT,                                -- Markdown 内容
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### `AP_activity_log` — 活动日志（P1）

```sql
CREATE TABLE AP_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES AP_projects(id) ON DELETE CASCADE,
  agent_id TEXT DEFAULT 'ottor',
  action TEXT NOT NULL,                        -- task_started | task_completed | stage_changed | note_added
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. 页面结构

```
/                       → 仪表盘（项目概览 + 统计）
/projects               → 项目列表
/projects/new           → 新增项目
/projects/[slug]        → 项目详情
/projects/[slug]/tasks  → 任务管理
/projects/[slug]/docs   → 研究文档 (P1)
```

### 页面设计要点

**仪表盘 `/`**
- 顶部统计卡片：总项目数、进行中、已完成
- 项目卡片网格：每张卡片显示名称、状态标签、当前阶段、最后更新时间
- 研究阶段进度条（6 步骤可视化）

**项目详情 `/projects/[slug]`**
- 顶部：项目名 + 状态 + 阶段进度条
- 左侧：任务列表（可拖拽状态变更）
- 右侧：项目描述 + 元数据

**新增项目 `/projects/new`**
- 表单：名称、Slug（自动生成）、描述、标签、初始阶段

---

## 5. 技术方案

### 前端
```
Next.js 14 (App Router)
├── app/
│   ├── layout.tsx          — 全局布局 (Sidebar + Header)
│   ├── page.tsx            — 仪表盘
│   ├── projects/
│   │   ├── page.tsx        — 项目列表
│   │   ├── new/page.tsx    — 新增项目
│   │   └── [slug]/
│   │       ├── page.tsx    — 项目详情
│   │       └── tasks/page.tsx — 任务管理
│   └── globals.css
├── components/
│   ├── ProjectCard.tsx
│   ├── StageProgress.tsx   — 研究阶段进度条
│   ├── TaskList.tsx
│   ├── Sidebar.tsx
│   └── Header.tsx
├── lib/
│   └── supabase.ts         — Supabase 客户端
└── types/
    └── index.ts            — TypeScript 类型定义
```

### Supabase 配置
- **URL**: `https://db.dora.restry.cn`
- **Auth**: 暂不需要用户认证（内部工具）
- **RLS**: 暂时关闭（MVP 简化）
- **Realtime**: P1 考虑用于实时状态更新

### 样式
- **Tailwind CSS** — 快速开发
- **暗色主题** — 与 Agentic BI 风格统一 (Catppuccin Mocha)
- **响应式** — 支持移动端查看

---

## 6. API 层

使用 Supabase JS Client 直接操作，不需要额外 API：

```typescript
// 示例
const { data } = await supabase
  .from('AP_projects')
  .select('*, AP_tasks(*)')
  .order('updated_at', { ascending: false });
```

Agent（Ottor）也可以通过 Supabase REST API 更新项目状态：
```bash
# Agent 更新任务状态
curl -X PATCH "https://db.dora.restry.cn/rest/v1/AP_tasks?id=eq.xxx" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "notes": "已完成"}'
```

---

## 7. 实施计划

| 阶段 | 内容 | 预计时间 |
|:---|:---|:---|
| **Phase 1** | 数据库建表 + Next.js 脚手架 + 项目列表页 | 30 min |
| **Phase 2** | 项目详情 + 任务管理 + 新增项目 | 30 min |
| **Phase 3** | 仪表盘 + 统计 + 样式打磨 | 20 min |
| **Phase 4** | 导入现有项目数据 + 测试 | 10 min |

总计约 **1.5 小时** 完成 MVP。

---

## 8. 开放问题（已确认）

1. **部署方式**: ✅ 端口 3002 + Caddy 反代 `project.dora.restry.cn`
2. **认证**: 🔜 搁置，暂不加
3. **Agent 集成深度**: ✅ project-sync 自动同步 + API 可写
4. **多 Agent**: ✅ 单 Agent（Ottor），不需要多 Agent 支持
5. **数据迁移**: ✅ 3 个项目已导入
