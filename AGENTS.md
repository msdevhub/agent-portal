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
CONTEXT.md       ← project context & status
DEPLOY.md        ← deployment documentation
poc/
  v3-shadcn/     ← React + shadcn/ui frontend (source)
  v2-pixel/      ← Express backend + static hosting
    server.js    ← API server (port 3002)
    public/      ← built frontend output (deploy target)
research/        ← research reports
tasks.json       ← task tracker
skills/          ← agent skills (project-sync, codex-delegate, tavily)
memory/          ← daily memory logs
```

## Deployment

- **Backend:** `poc/v2-pixel/server.js` on port 3002
- **Frontend build:** `cd poc/v3-shadcn && npx tsc --noEmit && npx vite build`
- **Deploy frontend:** `cp -r poc/v3-shadcn/dist/* poc/v2-pixel/public/`
- **HTTPS URL:** `https://agent-project.clawlines.net/`
- **Caddy:** reverse proxy `agent-project.clawlines.net` → `localhost:3002`

## Health Check

服务跑在**本机** port 3002。
- 网页检查: `curl -s -o /dev/null -w '%{http_code}' https://agent-project.clawlines.net/`
- API 检查: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/api/projects`
- 进程检查: `ss -tlnp | grep 3002`
- 如果挂了: `cd poc/v2-pixel && nohup node server.js > /tmp/portal-server.log 2>&1 &`

## API

- Base URL: `http://localhost:3002/api`
- CRUD: `/projects`, `/tasks`, `/artifacts`, `/timeline`
- Doc serve: `/api/doc/<slug>/<file>`

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
