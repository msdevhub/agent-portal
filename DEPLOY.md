# Agent Portal — 部署文档

## 1. 启动服务 (Next.js)

```bash
cd /home/resley/.openclaw/workspace-research/projects/agent-portal/poc/agent-portal
npm install
npm run build
nohup npm start -- -p 3002 > /tmp/agent-portal.log 2>&1 &
```

- 端口: **3002** (固定)
- 数据库: 直连 Supabase (via `/pg/query`)

## 2. 配置反向代理 (Caddy)

在 `/etc/caddy/Caddyfile` 追加：

```caddyfile
project.dora.restry.cn {
    reverse_proxy localhost:3002
}
```

## 3. 自动更新任务 (Agent 集成)

Agent 可以通过调用 Supabase `/pg/query` 接口来更新任务状态。

示例函数 (Python):

```python
import requests, json

SUPABASE_URL = "https://db.dora.restry.cn"
SERVICE_KEY = "..."  # Service Role Key

def update_task(task_id, status, notes=None):
    sql = f"UPDATE \"AP_tasks\" SET status = '{status}'"
    if notes:
        sql += f", notes = '{notes}'"
    sql += f" WHERE id = '{task_id}'"
    
    requests.post(
        f"{SUPABASE_URL}/pg/query",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json"
        },
        json={"query": sql}
    )
```
