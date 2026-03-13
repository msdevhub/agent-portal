# Agent Portal 开发指令

## 项目概述
构建研究项目管理平台，用 Next.js 14 (App Router) + Tailwind CSS + Supabase。

## Supabase 连接
**重要**: 此 Supabase 实例的 PostgREST REST API (`/rest/v1/`) 不可用（返回 404），所以**不能使用 `@supabase/supabase-js` 客户端**。

替代方案：使用 Supabase 的 `/pg/query` 端点直接执行 SQL：

```typescript
// lib/db.ts
const SUPABASE_URL = 'https://db.dora.restry.cn';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

export async function query<T = any>(sql: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`DB query failed: ${res.status}`);
  return res.json();
}
```

## 数据表（前缀 AP_，已创建，有数据）

### AP_projects
- id UUID PK
- name TEXT
- slug TEXT UNIQUE
- description TEXT
- status TEXT (active|completed|paused|archived)
- stage TEXT (question|literature|hypothesis|poc|conclusion|report)
- tags TEXT[]
- agent_id TEXT
- metadata JSONB
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

### AP_tasks
- id UUID PK
- project_id UUID FK -> AP_projects.id
- title TEXT
- description TEXT
- stage TEXT
- status TEXT (pending|in_progress|done|blocked)
- priority INTEGER
- notes TEXT
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ

### AP_documents (P1, exists but no data yet)
### AP_activity_log (P1, exists but no data yet)

## 页面结构

```
/                        → 仪表盘 (项目统计 + 项目卡片网格)
/projects                → 项目列表 (跳转到 / 即可)
/projects/new            → 新增项目表单
/projects/[slug]         → 项目详情 (阶段进度条 + 任务列表)
/projects/[slug]/edit    → 编辑项目
```

## 设计要求

### 主题: Catppuccin Mocha (暗色)
- 背景: #11111b (base), #181825 (mantle), #1e1e2e (crust)
- 文字: #cdd6f4 (text), #a6adc8 (subtext)
- 蓝色: #89b4fa, 紫色: #cba6f7, 绿色: #a6e3a1, 黄色: #f9e2af, 红色: #f38ba8
- 边框: #313244

### 全局布局
- 左侧 Sidebar (可折叠, 200px):
  - Logo: "🔬 Agent Portal"
  - 导航: 仪表盘, 项目列表
- 右侧: 内容区

### 仪表盘 `/`
- 顶部 3 个统计卡片: 总项目数 | 进行中 | 已完成
- 项目卡片网格 (2-3列):
  - 每张卡片: 项目名, 状态标签(彩色), 阶段进度条, 标签, 最后更新时间
  - 点击进入详情

### 研究阶段进度条 (StageProgress 组件)
6 个阶段: 提问 → 文献调研 → 假设 → POC验证 → 结论 → 报告
- 已完成: 实心圆 + 蓝色连线
- 当前: 脉冲动画圆
- 未开始: 空心圆 + 灰色连线

### 项目详情 `/projects/[slug]`
- 顶部: 项目名 + 编辑按钮 + 状态标签
- 阶段进度条
- 任务列表:
  - 任务卡片: 标题 + 状态标签 + 阶段 + 备注
  - 可点击切换状态 (pending → in_progress → done)
  - 新增任务按钮
- 项目元数据: 标签, 创建时间, 技术栈

### 新增项目 `/projects/new`
- 表单: 名称, Slug(自动生成), 描述, 标签(多选), 初始阶段
- 保存后跳转到详情页

## 技术要求
- Next.js 14 App Router (use `app/` directory)
- TypeScript strict mode
- Tailwind CSS (already in Next.js default setup)
- Server Actions for data mutations (create/update)
- Server Components for data fetching
- No authentication needed (MVP internal tool)
- Port: 18820 (set in package.json scripts)
- 所有数据库操作使用 `lib/db.ts` 的 `query()` 函数
- **不要使用 @supabase/supabase-js**

## 注意事项
- SQL 中表名必须用双引号: `"AP_projects"`, `"AP_tasks"`
- 使用参数化查询防止 SQL 注入（或至少转义用户输入）
- `tags` 列是 PostgreSQL TEXT[] 类型
- `metadata` 列是 JSONB 类型
