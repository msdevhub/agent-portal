# AGENTS.md - PortalBot 🏗️ (Agent Portal Dev Agent)

## Every Session

1. Read `SOUL.md`, `USER.md`, `IDENTITY.md`
2. Read `CONTEXT.md` to restore project context
3. Check `tasks.json` for pending tasks
4. If pending tasks exist, report status or continue work

## Safety

- Don't exfiltrate private data
- `trash` > `rm`
- When in doubt, ask

## Project Structure

```
CONTEXT.md       ← project context & status (单一事实源)
app/
  server.cjs     ← Express API server (PORT=3002)
  src/           ← React frontend source
  dist/          ← built frontend output
digest/          ← Python Digest Pipeline (L0→L3)
  digest.py      ← pipeline 入口
  pipeline/      ← collector/extractor/aggregator/tracker/insights
  push/          ← pusher/db/supabase/notifier
  server/        ← trigger server (port 18790)
caddy/           ← Caddy 反代配置
tasks.json       ← task tracker
skills/          ← agent skills
```

## Deployment

- **Backend:** `app/server.cjs` with `PORT=3002`
- **Frontend build:** `cd app && npx vite build`
- **Frontend serve:** pm2 serve dist on port 3013
- **HTTPS URL:** `https://portal.dev.dora.restry.cn/`
- **Caddy:** 主站 → `localhost:3013`, `/api/*` → `localhost:3002`
- **Git:** `https://github.com/msdevhub/agent-portal`

## Health Check

服务跑在**本机** port 3002 (API) + port 3013 (静态前端)。
- 网页检查: `curl -s -o /dev/null -w '%{http_code}' https://portal.dev.dora.restry.cn/`
- API 检查: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/api/ap-projects`
- 进程检查: `ss -tlnp | grep -E '3002|3013'`
- 如果 API 挂了: `cd app && PORT=3002 DATABASE_URL="postgresql://agent_portal:AgentP0rtal2026!@localhost:5432/postgres" nohup node server.cjs > /tmp/portal-server.log 2>&1 &`
- 如果前端挂了: `pm2 restart dev-portal`

## API

- Base URL: `http://localhost:3002/api`
- Projects: `/ap-projects`, `/ap-projects/:id`, `/project-action`, `/project-chat`, `/project-merge`
- Bots: `/bots`, `/bots/:id`
- Activities: `/daily-activities`, `/daily-timeline`
- Artifacts: `/artifacts`
- Digest: `/digest/refresh` (triggers pipeline via MM DM)

## Key Identifiers

- **GitHub:** `https://github.com/msdevhub/agent-portal`
- **Portal UUID:** `171cebe0-425c-474f-a400-bb4638b610a3`
- **Server PID:** 可变，用 `ss -tlnp | grep 3002` 确认
- **Supabase URL:** `https://db.dora.restry.cn`

## Communication

- 有问题或进度直接 DM Dad (@dora)
- 不需要经过协调中心 (research agent)

## 开发环境

- **HTTPS URL**: `https://portal.dev.dora.restry.cn`
- **Caddy 反向代理**: `portal.dev.dora.restry.cn` → `localhost:3013`

### 自运维（每次启动检查）
1. `pm2 list` 检查 `dev-portal` 是否 online
2. 如果不在或 errored → `pm2 serve /home/resley/.openclaw/workspace-research-portal/poc/v3-shadcn/dist 3013 --name dev-portal --spa`
3. 如果在但 errored → `pm2 restart dev-portal`
4. 确认 `curl -s -o /dev/null -w '%{http_code}' http://localhost:3013/` 返回 200

### 双端口体系
| 用途 | 端口 | 说明 |
|------|------|------|
| pm2 serve (静态 dist) | **3013** | Caddy 指向这里，`pm2 restart dev-portal` |
| vite dev (热更新) | **4013** | 调试用，`npm run dev` 启动 |

- **pm2 服务名**: `dev-portal`
- **pm2 管理**: `pm2 restart dev-portal` / `pm2 logs dev-portal` / `pm2 stop dev-portal`
- **vite 调试**: `cd poc/v3-shadcn && npm run dev` (端口 4013，vite.config.ts 已配置)
- **重建 dist 后**: `npm run build` → `pm2 restart dev-portal` 即生效
- 其他端口: 3014 (后端), 3015 (备用)
- ⚠️ Portal 后端跑在 claw-runtime 容器 (3002→3019)，Caddy 单独配了 `/api/*` → `172.17.0.1:3002`
- ⚠️ 不要直接暴露 HTTP 端口给外部
