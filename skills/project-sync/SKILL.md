---
name: project-sync
description: Sync this project's status to Agent Portal API. Updates description from CONTEXT.md and checks pending tasks.
---

# Project Sync (Single Project)

Syncs THIS workspace's project state to Agent Portal API.

## Steps

1. Run `node skills/project-sync/scripts/sync.mjs`
2. Output the result, nothing more.

## Output Rules

- If sync reports `descUpdated: true` or `pendingTasks > 0`, output ONE line summary
- If nothing changed (descUpdated false, pendingTasks 0), reply ONLY: `HEARTBEAT_OK`
- Do NOT add activity summaries, bullet lists, or commentary
- Do NOT repeat previous sync results

## Example Output

Good (something changed):
```
Portal Sync: ✅ 描述已更新 | 待处理任务: 2
```

Good (nothing changed):
```
HEARTBEAT_OK
```

Bad (do NOT do this):
```
[ACTIVITY_REPORT]
📝 clawline-gateway 近期活动:
- 创建 admin-new UI...
- 完成 Logto OAuth2...
```

## Git Status Check

After sync, check for uncommitted or unpushed local code:

3. Check git status in the project repo directory:
   ```bash
   cd poc && git status --porcelain
   git log @{u}.. --oneline 2>/dev/null
   ```
4. If there are uncommitted changes or unpushed commits, append to output:
   - `⚠️ 未提交: X 个文件` (if uncommitted files exist)
   - `⚠️ 未推送: X 个commit` (if unpushed commits exist)
5. If git is clean AND synced with remote, do not mention git at all.

## Usage

```bash
node skills/project-sync/scripts/sync.mjs
node skills/project-sync/scripts/sync.mjs --dry-run
```

## Rules

- **No artifact auto-creation** — artifacts are manually curated
- **No meta-tasks** — don't create self-referencing sync tasks
- CONTEXT.md excluded from artifacts
- Keep output minimal — one line or HEARTBEAT_OK
