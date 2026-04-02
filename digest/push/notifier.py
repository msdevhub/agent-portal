"""
Mattermost notification to Daddy (v4.1).

Sends a project board update after the pipeline finishes.
Deduplicates blocked items with the same root cause.
"""

import json
import urllib.request
from datetime import datetime, timezone, timedelta

from config import MM_API, MM_ADMIN_TOKEN, DADDY_USER_ID

TZ_SHANGHAI = timezone(timedelta(hours=8))

# Lazily resolved DM channel ID
_daddy_dm_channel = None


def _get_daddy_dm_channel() -> str:
    """Get or create the DM channel between this bot and Daddy."""
    global _daddy_dm_channel
    if _daddy_dm_channel:
        return _daddy_dm_channel

    # 1. Get bot's own user ID
    req = urllib.request.Request(
        f"{MM_API}/users/me",
        headers={"Authorization": f"Bearer {MM_ADMIN_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        bot_id = json.loads(resp.read()).get("id")

    # 2. Create or get existing DM channel
    data = json.dumps([bot_id, DADDY_USER_ID]).encode()
    req = urllib.request.Request(
        f"{MM_API}/channels/direct",
        data=data,
        headers={
            "Authorization": f"Bearer {MM_ADMIN_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        _daddy_dm_channel = json.loads(resp.read()).get("id")

    return _daddy_dm_channel


def _dedup_blocked(blocked: list) -> list:
    """Merge blocked items sharing the same next_action prefix."""
    if len(blocked) <= 1:
        return blocked

    groups = {}
    for u in blocked:
        na = (u.get("next_action") or "").strip()
        key = na[:15] if na else u.get("project_name", "")
        if key not in groups:
            groups[key] = {
                "projects": [],
                "next_action": na,
                "current_summary": u.get("current_summary", ""),
            }
        groups[key]["projects"].append(u.get("project_name", "?"))

    deduped = []
    for key, g in groups.items():
        if len(g["projects"]) == 1:
            deduped.append({
                "project_name": g["projects"][0],
                "current_summary": g["current_summary"],
                "next_action": g["next_action"],
                "health": "blocked",
            })
        else:
            names = "、".join(g["projects"][:3])
            if len(g["projects"]) > 3:
                names += f" 等{len(g['projects'])}个"
            deduped.append({
                "project_name": names,
                "current_summary": f"{len(g['projects'])} 个项目有相同阻塞",
                "next_action": g["next_action"],
                "health": "blocked",
                "_merged": True,
            })

    return deduped


def notify_daddy(date_str: str, project_updates: list, all_projects: list):
    """Send a project board summary to Daddy via Mattermost DM."""
    if not project_updates:
        return

    now = datetime.now(TZ_SHANGHAI)
    time_str = now.strftime("%H:%M")

    blocked = [u for u in project_updates if u.get("health") == "blocked"]
    attention = [u for u in project_updates if u.get("health") == "attention"]
    healthy = [u for u in project_updates if u.get("health") == "healthy"]
    stale = [u for u in project_updates if u.get("health") == "stale"]

    blocked = _dedup_blocked(blocked)

    msg = f"📋 **项目看板更新 {date_str} {time_str}**\n\n"

    total_active = len(project_updates)
    total_all = len(all_projects) if all_projects else total_active
    msg += f"**{total_active}/{total_all}** 个项目有今天的动态\n\n"

    if blocked:
        msg += "🔴 **需要你决策：**\n"
        for u in blocked[:5]:
            msg += f" • **{u.get('project_name', '?')}** — {u.get('current_summary', '')}\n"
            if u.get("next_action"):
                msg += f"   → {u['next_action']}\n"
        msg += "\n"

    if attention:
        msg += "🟡 **需要关注：**\n"
        for u in attention[:5]:
            msg += f" • **{u.get('project_name', '?')}** — {u.get('current_summary', '')}\n"
            if u.get("next_action"):
                msg += f"   → {u['next_action']}\n"
        if len(attention) > 5:
            msg += f" • ...还有 {len(attention) - 5} 个\n"
        msg += "\n"

    if healthy:
        msg += f"🟢 **正常推进：** {len(healthy)} 个\n"
        for u in healthy[:3]:
            msg += f" • {u.get('project_name', '?')} — {u.get('current_summary', '')}\n"
        if len(healthy) > 3:
            msg += f" • ...还有 {len(healthy) - 3} 个\n"
        msg += "\n"

    if stale:
        msg += f"⚪ **超过3天没动的：** {len(stale)} 个\n"
        for u in stale[:3]:
            msg += f" • {u.get('project_name', '?')}\n"
        msg += "\n"

    msg += f"👉 [在门户查看](https://portal.dev.dora.restry.cn)"

    channel = _get_daddy_dm_channel()
    _send_mm(channel, msg)
    print(f"  📬 已通知 Daddy（{time_str}）")


def _send_mm(channel_id: str, message: str):
    """Post a message via Mattermost Admin Token."""
    data = json.dumps({"channel_id": channel_id, "message": message}).encode()
    req = urllib.request.Request(
        f"{MM_API}/posts",
        data=data,
        headers={
            "Authorization": f"Bearer {MM_ADMIN_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as e:
        print(f"  ⚠️ 通知发送失败: {e}")
