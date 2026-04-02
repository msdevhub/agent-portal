# Agent Portal

研究项目管理平台 — 自动追踪所有 AI Agent 的工作状态，以 Kanban 看板呈现项目进度，替代人工检查聊天记录。

**线上地址:** https://portal.dev.dora.restry.cn  
**仓库:** https://github.com/msdevhub/agent-portal

## 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                    Caddy (HTTPS)                         │
│  portal.dev.dora.restry.cn                               │
│    /api/*  → localhost:3002  (Express API)                │
│    /*      → localhost:3013  (pm2 serve dist)             │
└──────────────────────────────────────────────────────────┘
         │                              │
    ┌────▼─────┐                 ┌──────▼──────┐
    │  Backend  │                │  Frontend   │
    │ server.cjs│                │ React+Vite  │
    │ port 3002 │◀──REST API────│ shadcn/ui   │
    └────┬──────┘                └─────────────┘
         │
    ┌────▼──────┐     ┌────────────────────────┐
    │ PostgreSQL │◀────│  Digest Pipeline       │
    │ (Supabase) │     │  (Python, cron 30min)  │
    │ AP_* 表    │     │  L0→L1→L1.5→L2→L3     │
    └────────────┘     └────────────────────────┘
                              │
                       ┌──────▼───────┐
                       │  Mattermost  │
                       │  (数据源+通知) │
                       └──────────────┘
```

## 目录结构

```
├── app/                    # 前端 + 后端
│   ├── server.cjs          # Express API server (port 3002)
│   ├── schema.sql          # 完整数据库 DDL (16 张表)
│   ├── src/                # React 前端源码
│   │   ├── pages/          # 页面组件
│   │   ├── components/     # UI 组件
│   │   └── lib/api.ts      # API 客户端
│   └── dist/               # 构建产物 (pm2 serve)
├── digest/                 # Digest Pipeline (Python)
│   ├── digest.py           # 入口
│   ├── config.py           # 环境变量配置
│   ├── pipeline/           # L0-L3 处理模块
│   ├── push/               # 数据推送 + 通知
│   ├── server/             # HTTP trigger server
│   └── scripts/            # Cron 安装脚本
├── caddy/                  # Caddy 反代配置参考
├── CONTEXT.md              # 项目上下文 & 变更日志
├── DEPLOY.md               # 部署文档 (旧版)
└── README.md               # ← 你在这里
```

## 快速开始

### 前提条件

- Node.js >= 18
- Python >= 3.10
- PostgreSQL (推荐 Supabase self-hosted)
- Caddy (反向代理 + HTTPS)
- PM2 (`npm i -g pm2`)

### 1. 数据库初始化

```bash
# 方式 A: 直接用 SQL 文件
psql -h localhost -U agent_portal -d postgres -f app/schema.sql

# 方式 B: 通过 API 端点 (服务启动后)
curl -X POST http://localhost:3002/api/init-db
```

> **Supabase 注意:** 如果用 supabase_admin 建的库，需先把 AP_ 表的 ownership 和 RLS 权限给 `agent_portal` 用户。详见 `app/schema.sql` 头部注释。

### 2. 后端

```bash
cd app
npm install

# 设置数据库连接
export DATABASE_URL="postgresql://agent_portal:<password>@localhost:5432/postgres"

# 启动 (port 3002)
PORT=3002 node server.cjs

# 或后台运行
PORT=3002 nohup node server.cjs > /tmp/portal-server.log 2>&1 &
```

### 3. 前端

```bash
cd app

# 开发模式 (port 4013, HMR)
npm run dev

# 构建生产版本
npx tsc --noEmit && npx vite build

# 用 PM2 serve 静态文件 (port 3013)
pm2 serve dist 3013 --name dev-portal --spa
```

### 4. Digest Pipeline

```bash
cd digest
cp .env.example .env
# 编辑 .env，填入 MM_ADMIN_TOKEN 等必要变量

# 手动运行
python3 digest.py

# 指定日期
python3 digest.py --date 2026-04-01

# 安装 cron (每 30 分钟, 09:00-23:59)
bash scripts/setup_cron.sh
```

详细 Pipeline 文档见 [digest/README.md](digest/README.md)。

### 5. Caddy 反向代理

```caddyfile
portal.dev.dora.restry.cn {
    handle /api/* {
        reverse_proxy localhost:3002
    }
    handle {
        reverse_proxy localhost:3013
    }
}
```

## 端口一览

| 端口  | 用途                        |
|------|-----------------------------|
| 3002 | Express API (server.cjs)    |
| 3013 | PM2 静态 serve (dist)       |
| 4013 | Vite dev server (调试)       |
| 18790| Digest trigger server       |

## 数据库表 (AP_ 前缀, 共 16 张)

| 类别 | 表名 | 用途 |
|------|------|------|
| **核心** | `AP_projects` | 项目注册 |
| | `AP_tasks` | 项目任务 |
| | `AP_notes` | 项目笔记 |
| | `AP_artifacts` | 项目产出物 |
| | `AP_timeline` | 项目事件线 |
| | `AP_project_actions` | 项目决策记录 |
| **Digest** | `AP_daily_activities` | Bot 每日聚合活动 |
| | `AP_daily_timeline` | Bot 每日事件明细 |
| | `AP_daily_reports` | Bot 每日报告 |
| | `AP_daily_insights` | 全局每日洞察 |
| **Kanban** | `AP_projects_v2` | AI 生成的项目卡片 |
| **Bot** | `AP_bots` | Bot 注册表 (agent_id ↔ MM) |
| **监控** | `AP_server_snapshots` | 服务器资源快照 |
| | `AP_site_checks` | 站点可用性检查 |
| | `AP_container_checks` | Docker 容器状态 |
| | `AP_cron_checks` | Cron 任务状态 |

完整 DDL 见 [`app/schema.sql`](app/schema.sql)。

## 技术栈

- **前端:** React 19 + Vite + shadcn/ui + Tailwind CSS
- **后端:** Node.js Express (server.cjs) + pg
- **Pipeline:** Python 3 + psycopg2 + OpenAI (gpt-4.1 / gpt-5.4)
- **数据库:** PostgreSQL (Supabase self-hosted)
- **认证:** Logto
- **部署:** Caddy + PM2

## 环境变量

### 后端 (server.cjs)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | — (必填) |
| `PORT` | 监听端口 | `3002` |

### Digest Pipeline

见 [`digest/.env.example`](digest/.env.example)，核心变量:

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 (推荐) |
| `MM_BASE_URL` | Mattermost 地址 |
| `MM_ADMIN_TOKEN` | Mattermost admin token |
| `L1_API_KEY` | Azure OpenAI API key |

## License

Private repository.
