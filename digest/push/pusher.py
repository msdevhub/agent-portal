"""
Push data to database: activities, timeline, projects, bots.

Uses push.db for database abstraction (PG direct or Supabase REST).
"""

import json
import uuid
from datetime import datetime, timezone

from push.db import db_select, db_insert, db_update, db_delete
from push.supabase import resolve_agent_id


# ====================================================================
# Activities (L1.5 aggregated tasks → AP_daily_activities)
# ====================================================================

def push_activities(l1_results: dict, date_str: str, aggregated_tasks: dict | None = None):
    """Push activities to AP_daily_activities."""
    print(f"\n📤 推送活动列表...")

    # Check table exists
    try:
        db_select("AP_daily_activities", limit=0)
    except Exception:
        print(f"  ⚠️ AP_daily_activities 表不存在，跳过")
        return

    # Delete old data for the same day
    db_delete("AP_daily_activities", {"date": date_str})

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
                db_insert("AP_daily_activities", rows)
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
                    db_insert("AP_daily_activities", rows[i:i + 50])
                total += len(rows)
                print(f"  ✅ {emoji} {username}: {len(rows)} 条活动")

    print(f"  📊 总计 {total} 条推送完毕")


# ====================================================================
# Timeline (L1 filtered key events → AP_daily_timeline)
# ====================================================================

def push_timeline(l1_results: dict, date_str: str):
    """Push L1 key events to AP_daily_timeline (deduplicated, capped)."""
    print(f"\n📤 推送时间线...")

    try:
        db_select("AP_daily_timeline", limit=0)
    except Exception:
        print(f"  ⚠️ AP_daily_timeline 表不存在，跳过")
        return

    db_delete("AP_daily_timeline", {"date": date_str})

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
                db_insert("AP_daily_timeline", rows[i:i + 50])
            total += len(rows)
            print(f"  ✅ {emoji} {username}: {len(rows)} 条时间线事件（原始 {len(events)} 条）")

    print(f"  📊 总计 {total} 条时间线事件推送完毕")


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

    existing = db_select("AP_bots", columns="agent_id, mm_username")
    existing_usernames = {b["mm_username"] for b in existing} if existing else set()

    new_count = 0
    update_count = 0

    for bot in mm_bots:
        username = bot["username"]
        agent_id = resolve_agent_id(username)
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

        data = {
            "agent_id": agent_id,
            "name": bot.get("display_name", username),
            "emoji": bot.get("emoji", "🤖"),
            "mm_user_id": bot["id"],
            "mm_username": username,
            "updated_at": now_str,
        }

        if username not in existing_usernames:
            data["created_at"] = now_str
            result = db_insert("AP_bots", data)
            if result is not None:
                new_count += 1
                print(f"  ✨ 新注册: {bot.get('emoji', '🤖')} {username} → {agent_id}")
        else:
            result = db_update("AP_bots", {"agent_id": agent_id}, {
                "name": data["name"],
                "emoji": data["emoji"],
                "mm_user_id": data["mm_user_id"],
                "updated_at": data["updated_at"],
            })
            if result is not None:
                update_count += 1

    print(f"  📊 新增 {new_count} 个，更新 {update_count} 个，总计 {len(mm_bots)} 个 bot")
