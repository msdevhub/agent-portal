"""
Push data to Supabase: activities, timeline, projects, bots.

Note: push_daily_reports / push_insights are from v3 and currently unused
by the v4 pipeline. They are retained here for potential future use.
"""

import json
import uuid
from datetime import datetime, timezone

from push.supabase import supabase_request, resolve_agent_id


# ====================================================================
# Activities (L1.5 aggregated tasks → AP_daily_activities)
# ====================================================================

def push_activities(l1_results: dict, date_str: str, aggregated_tasks: dict | None = None):
    """Push activities to AP_daily_activities.

    If aggregated_tasks (from L1.5) is provided, push those (5-10 per bot).
    Otherwise fall back to raw L1 events (not recommended).
    """
    print(f"\n📤 推送活动列表到 Supabase...")

    test = supabase_request(f"AP_daily_activities?limit=0", data=None, method="GET")
    if test is None:
        print(f"  ⚠️ AP_daily_activities 表不存在，跳过")
        return

    # Delete old data for the same day (overwrite)
    supabase_request(
        f"AP_daily_activities?date=eq.{date_str}",
        data=None,
        method="DELETE",
    )

    total = 0

    if aggregated_tasks:
        for username, tasks in aggregated_tasks.items():
            agent_id = resolve_agent_id(username)
            emoji = l1_results.get(username, {}).get("bot_emoji", "🤖")

            rows = []
            for task in tasks:
                rows.append({
                    "id": str(uuid.uuid4()),
                    "agent_id": agent_id,
                    "date": date_str,
                    "time": task.get("time_range", ""),
                    "action": task.get("status", "info"),
                    "content": task.get("title", ""),
                    "detail": json.dumps({
                        "summary": task.get("summary", ""),
                        "deliverables": task.get("deliverables", []),
                        "event_count": task.get("event_count", 0),
                    }, ensure_ascii=False),
                })

            if rows:
                supabase_request("AP_daily_activities", data=rows)
                total += len(rows)
                print(f"  ✅ {emoji} {username}: {len(rows)} 个任务")
    else:
        print(f"  ⚠️ 无聚合数据，降级推 L1 原始事件")
        for username, l1_data in l1_results.items():
            agent_id = resolve_agent_id(username)
            events = l1_data.get("events", [])
            emoji = l1_data.get("bot_emoji", "🤖")

            rows = []
            for evt in events:
                rows.append({
                    "id": str(uuid.uuid4()),
                    "agent_id": agent_id,
                    "date": date_str,
                    "time": evt.get("time", ""),
                    "action": evt.get("status", "info"),
                    "content": evt.get("content", ""),
                    "detail": json.dumps({
                        "who": evt.get("who", ""),
                        "original_action": evt.get("action", ""),
                        "detail": evt.get("detail", ""),
                        "references": evt.get("references", []),
                        "deliverables": evt.get("deliverables", []),
                    }, ensure_ascii=False),
                })

            if rows:
                for i in range(0, len(rows), 50):
                    batch = rows[i:i + 50]
                    supabase_request("AP_daily_activities", data=batch)
                total += len(rows)
                print(f"  ✅ {emoji} {username}: {len(rows)} 条活动")

    print(f"  📊 总计 {total} 条推送完毕")


# ====================================================================
# Timeline (L1 filtered key events → AP_daily_timeline)
# ====================================================================

def push_timeline(l1_results: dict, date_str: str):
    """Push L1 key events to AP_daily_timeline (deduplicated, capped)."""
    print(f"\n📤 推送时间线到 Supabase...")

    test = supabase_request(f"AP_daily_timeline?limit=0", data=None, method="GET")
    if test is None:
        print(f"  ⚠️ AP_daily_timeline 表不存在，跳过（请先调用 /api/init-db）")
        return

    supabase_request(
        f"AP_daily_timeline?date=eq.{date_str}",
        data=None,
        method="DELETE",
    )

    total = 0
    for username, l1_data in l1_results.items():
        agent_id = resolve_agent_id(username)
        events = l1_data.get("events", [])
        emoji = l1_data.get("bot_emoji", "🤖")

        # Filter: meaningful events, deduplicate
        seen_content = set()
        filtered = []
        for evt in events:
            content = evt.get("content", "").strip()
            if not content or len(content) < 5:
                continue
            action = evt.get("action", "")
            if action in ("ping", "pong", "status"):
                continue
            key = content[:30].lower()
            if key in seen_content:
                continue
            seen_content.add(key)
            filtered.append(evt)

        # Cap at ~30 events per bot
        if len(filtered) > 30:
            mid_count = min(10, len(filtered) - 20)
            step = max(1, (len(filtered) - 20) // mid_count)
            middle = filtered[10:-10:step][:mid_count]
            filtered = filtered[:10] + middle + filtered[-10:]

        rows = []
        for evt in filtered:
            rows.append({
                "id": str(uuid.uuid4()),
                "agent_id": agent_id,
                "date": date_str,
                "time": evt.get("time", ""),
                "who": evt.get("who", ""),
                "action": evt.get("action", ""),
                "content": evt.get("content", ""),
                "status": evt.get("status", ""),
                "deliverables": json.dumps(evt.get("deliverables", []), ensure_ascii=False),
            })

        if rows:
            for i in range(0, len(rows), 50):
                supabase_request("AP_daily_timeline", data=rows[i:i + 50])
            total += len(rows)
            print(f"  ✅ {emoji} {username}: {len(rows)} 条时间线事件（原始 {len(events)} 条）")

    print(f"  📊 总计 {total} 条时间线事件推送完毕")


# ====================================================================
# Projects (project_tracker cache → AP_projects)
# ====================================================================

def push_projects(projects: list[dict]):
    """Push project data to AP_projects (upsert on name)."""
    print(f"\n📤 推送 {len(projects)} 个项目到 AP_projects...")

    for p in projects:
        if p.get("curated", False):
            print(f"  🔒 {p['name']} (curated, skipped)")
            continue

        data = {
            "id": p.get("id", str(uuid.uuid4())),
            "name": p.get("name", ""),
            "slug": p.get("name", "").lower().replace(" ", "-").replace("/", "-")[:50],
            "description": p.get("description", ""),
            "status": p.get("status", "discovering"),
            "tags": p.get("tags", []),
            "agent_id": resolve_agent_id(p.get("primary_bot", "")) or "rabbit",
            "emoji": p.get("emoji", "📋"),
            "metadata": {
                "auto_generated": p.get("auto_generated", True),
                "first_seen": p.get("first_seen", ""),
                "last_active": p.get("last_active", ""),
                "involved_bots": [resolve_agent_id(b) for b in p.get("involved_bots", [])],
                "primary_bot": p.get("primary_bot", ""),
                "milestones": p.get("milestones", []),
                "next_actions": p.get("next_actions", []),
                "deliverables": p.get("deliverables", []),
                "merged_into": p.get("merged_into", ""),
                "user_notes": p.get("user_notes", ""),
            },
            "updated_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

        result = supabase_request(
            "AP_projects?on_conflict=id",
            data=data,
            headers_extra={"Prefer": "return=representation,resolution=merge-duplicates"},
        )

        if result:
            print(f"  ✅ {p['name']}")
        else:
            print(f"  ❌ {p['name']}")


# ====================================================================
# Bot registry sync (MM → AP_bots)
# ====================================================================

def sync_bots(collected_data: dict | None = None):
    """Sync bot list from Mattermost to AP_bots table."""
    from pipeline.collector import get_all_bot_users

    print(f"\n🔄 同步 bot 注册表...")

    mm_bots = get_all_bot_users()
    print(f"  MM 上发现 {len(mm_bots)} 个 bot")

    mm_bots = [b for b in mm_bots if b["username"] not in ("system-bot",)]

    existing = supabase_request("AP_bots?select=agent_id,mm_username", data=None, method="GET")
    existing_usernames = set()
    if existing:
        existing_usernames = {b["mm_username"] for b in existing}

    new_count = 0
    update_count = 0

    for bot in mm_bots:
        username = bot["username"]
        agent_id = resolve_agent_id(username)

        data = {
            "agent_id": agent_id,
            "name": bot.get("display_name", username),
            "emoji": bot.get("emoji", "🤖"),
            "mm_user_id": bot["id"],
            "mm_username": username,
            "updated_at": datetime.now(timezone.utc).isoformat() + "Z",
        }

        if username not in existing_usernames:
            data["created_at"] = datetime.now(timezone.utc).isoformat() + "Z"
            result = supabase_request("AP_bots", data=data)
            if result:
                new_count += 1
                print(f"  ✨ 新注册: {bot.get('emoji', '🤖')} {username} → {agent_id}")
        else:
            result = supabase_request(
                f"AP_bots?agent_id=eq.{agent_id}",
                data={
                    "name": data["name"],
                    "emoji": data["emoji"],
                    "mm_user_id": data["mm_user_id"],
                    "updated_at": data["updated_at"],
                },
                method="PATCH",
            )
            if result:
                update_count += 1

    print(f"  📊 新增 {new_count} 个，更新 {update_count} 个，总计 {len(mm_bots)} 个 bot")
