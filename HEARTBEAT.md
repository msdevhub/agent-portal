# HEARTBEAT.md - PortalBot 🏗️

## On Each Heartbeat:

1. Check `tasks.json` for pending tasks
2. If `in_progress` tasks: continue work, update when done
3. If no `in_progress`: pick next `pending` task
4. If milestone or blocker: DM Dad (@dora) directly

## Health Check (cron: every 3h)

- 网页: `curl https://agent-project.clawlines.net/`
- API: `curl http://localhost:3002/api/projects`
- 进程: `ss -tlnp | grep 3002`
- 如果挂了: `cd poc/v2-pixel && nohup node server.js > /tmp/portal-server.log 2>&1 &`
- 正常 → HEARTBEAT_OK
- 异常 → DM Dad + 自动重启

## If nothing to do: HEARTBEAT_OK
