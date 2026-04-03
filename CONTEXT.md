# Agent Portal — 项目上下文

## 项目概况
研究项目管理平台 — 网页版查看和管理所有研究项目、Bot 状态、任务、产出物和时间线。

## 当前状态
- 阶段: 🔨 验证 (build)
- 版本: v4.0
- 线上: https://portal.dev.dora.restry.cn
- Git: https://github.com/msdevhub/agent-portal

## 维护者变更 (2026-04-02)
项目从 Rabbit 正式移交给 PortalBot，包括前端、后端和 Digest Pipeline 的全部维护。

## 最近更新 (2026-04-02)

### v4.0 — PG 直连 + Digest Pipeline 接管
- Rabbit 提交 commit 47806f7: server.cjs 和 Python digest pipeline 支持 `DATABASE_URL` 直连 PG
- 新增 `digest/` 目录: 完整的 Python pipeline (L0→L1→L1.5→L2→L3→通知)
- 修复 PG 直连兼容性: 添加 `toDateStr()` 处理 Date 对象 vs 字符串差异
- 修复 RLS 权限: disable 了 supabase_admin 拥有的 AP_ 表的 Row Level Security
- GRANT ALL AP_ 表权限给 `agent_portal` 用户

### v3.9 — Project Kanban + 功能扩展 (2026-03-31 ~ 04-01)
- Project Kanban Tab 作为默认首页，替代 daily insights
- 拖拽排序项目卡片 (mobile touch sensor 优化)
- 项目决策 approve/reject (POST /api/project-action)
- Chat 功能 (POST /api/project-chat via MM API)
- AI 项目合并 (POST /api/project-merge)
- BotDetailPage 滚动加载替代日期选择器
- Slim API 响应 (561KB → 13KB)
- 过滤 dismissed 项目, idle 状态检测
- Refresh 按钮改为 MM DM 触发 pipeline

## 架构

### 目录结构
```
app/                   ← 前端(React+Vite) + 后端(server.cjs)
  server.cjs           ← Express API server
  src/                 ← React 前端源码
  dist/                ← 构建输出
caddy/                 ← Caddy 反代配置
digest/                ← Python Digest Pipeline
  digest.py            ← 入口
  config.py            ← 配置
  pipeline/            ← L0-L3 处理模块
    collector.py       ← L0: MM 消息采集
    extractor.py       ← L1: LLM 结构化提取 (gpt-4.1)
    aggregator.py      ← L1.5: 任务聚合
    project_tracker.py ← L2: 项目缓存+匹配
    project_insights.py← L3: 项目状态分析 (gpt-5.4)
    llm.py             ← LLM 调用抽象
  push/                ← 数据推送
    pusher.py          ← 推送到 DB
    db.py              ← 🆕 DB 抽象层 (PG直连/REST回退)
    supabase.py        ← Supabase REST 工具
    notifier.py        ← 通知 Daddy
  server/
    trigger.py         ← Trigger server (port 18790)
```

### 服务端口
| 端口 | 用途 |
|------|------|
| 3002 | server.cjs (PORT=3002 启动, Caddy /api/* 指向) |
| 3013 | pm2 serve 静态 dist (Caddy 主站指向) |
| 4013 | Vite dev server (调试用) |
| 18790 | Digest trigger server |

### 数据库
- PG 直连: `DATABASE_URL` 环境变量 (必填)
- 所有表以 `AP_` 前缀
- supabase_admin 拥有的表已 disable RLS

### 环境变量 (必填)
参见 `.env.example`。后端和 Pipeline 共用以下变量：
| 变量 | 用途 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `MM_BASE_URL` | Mattermost 地址 |
| `MM_ADMIN_TOKEN` | Mattermost admin token |
| `L1_BASE_URL` | Azure OpenAI endpoint |
| `L1_API_KEY` | Azure OpenAI key |

⚠️ 不再支持 Supabase REST 回退，所有 secret 不硬编码。缺失则进程启动报错退出。

### Agent ID 映射 (MM username → Portal ID)
| MM Username | Portal ID |
|---|---|
| ottor-pc-cloud-bot | rabbit |
| researcher | research |
| craftbot | research-craft |
| portalbot | research-portal |
| bibot | research-bi |
| gatewaybot | clawline-gateway |
| channelbot | clawline-channel |
| webbot | clawline-client-web |

### Mattermost 集成
- MM Base URL: https://mm.dora.restry.cn
- Portal Chat 用 admin token 以 @dora 身份发消息到 bot DM
- Daddy↔portalbot DM channel: y71spmrpifbhzgidtzesgyxrqy

## ⚠️ 已知问题
1. Artifact RETURNING clause 报错但数据已写入 — 用 GET 验证
2. artifact_count 不自动更新 — 前端直接查 /api/artifacts
3. PATCH metadata 会清空 artifacts 数组 — 必须用单独 /api/artifacts 端点
4. pg_hba.conf 只允许 Docker 子网 (172.18.0.0/16)
5. trigger_server.py 偶发 502

## 技术栈
- 前端: Vite + React 19 + shadcn/ui + Tailwind
- 后端: Node.js Express (server.cjs)
- Pipeline: Python 3 + psycopg2 + OpenAI
- 数据库: PostgreSQL (Supabase self-hosted)
- 认证: Logto (https://logto.dr.restry.cn), 测试: test_all_apps / Test@2026
