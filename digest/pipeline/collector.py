"""
L0: Mattermost data collection + filtering.

Pulls Daddy ↔ bot DM history from the Mattermost Admin API.
Supports incremental collection with per-bot cursors.
"""

import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta

from config import (
    MM_API, MM_ADMIN_TOKEN, DADDY_USER_ID,
    FILTER_PATTERNS, BOT_EMOJI, DATA_DIR,
)

TZ_SHANGHAI = timezone(timedelta(hours=8))


def mm_get(path: str, params: dict | None = None) -> dict | list:
    """Call a Mattermost GET endpoint."""
    url = f"{MM_API}{path}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {MM_ADMIN_TOKEN}",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_all_bot_users() -> list[dict]:
    """Fetch all bot users from MM (excluding Daddy, system bots, real users)."""
    users = []
    page = 0
    while True:
        batch = mm_get("/users", {"per_page": "200", "page": str(page)})
        if not batch:
            break
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1

    bots = []
    system_bots = {"calls", "playbooks", "feedbackbot", "boards", "copilot"}
    real_users = {"dora", "chenjt", "ekin17", "jadefather", "wpsl5168", "zzq", "wukong"}

    for u in users:
        uid = u["id"]
        username = u.get("username", "")
        if uid == DADDY_USER_ID:
            continue
        if username in system_bots:
            continue
        if username in real_users:
            continue
        is_bot = u.get("is_bot", False)
        if is_bot or username in BOT_EMOJI:
            bots.append({
                "id": uid,
                "username": username,
                "display_name": u.get("first_name", "") or username,
                "emoji": BOT_EMOJI.get(username, "🤖"),
            })
    return bots


def get_dm_channel(bot_user_id: str) -> str | None:
    """Get or create the DM channel between Daddy and a bot."""
    try:
        data = json.dumps([DADDY_USER_ID, bot_user_id]).encode()
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
            ch = json.loads(resp.read())
            return ch.get("id")
    except urllib.error.HTTPError as e:
        print(f"      ⚠️ DM channel HTTP {e.code}, 跳过")
        return None
    except Exception as e:
        print(f"      ⚠️ DM channel 失败: {e}, 跳过")
        return None


def get_posts_since(channel_id: str, since_ms: int) -> list[dict]:
    """Fetch all posts in a channel since `since_ms` (auto-paginate, deduplicate)."""
    seen_ids = set()
    all_posts = []
    page = 0
    max_pages = 20
    while page < max_pages:
        result = mm_get(f"/channels/{channel_id}/posts", {
            "since": str(since_ms),
            "per_page": "200",
            "page": str(page),
        })
        if not result or "posts" not in result:
            break
        posts = result["posts"]
        order = result.get("order", [])
        new_count = 0
        for pid in order:
            if pid not in seen_ids:
                seen_ids.add(pid)
                all_posts.append(posts.get(pid, {}))
                new_count += 1
        if new_count == 0 or len(order) < 200:
            break
        page += 1
    return all_posts


def filter_posts(posts: list[dict]) -> list[dict]:
    """L0 filter: drop heartbeats, NO_REPLY, system messages, empty."""
    filtered = []
    for p in posts:
        msg = p.get("message", "").strip()
        if not msg:
            continue
        skip = False
        for pattern in FILTER_PATTERNS:
            if pattern in msg:
                skip = True
                break
        if skip:
            continue
        if p.get("type", "") and p["type"].startswith("system_"):
            continue
        filtered.append(p)
    return filtered


def format_posts_for_llm(posts: list[dict], bot_info: dict) -> str:
    """Format a list of posts into an LLM-readable conversation transcript."""
    posts_sorted = sorted(posts, key=lambda p: p.get("create_at", 0))

    lines = []
    for p in posts_sorted:
        ts = p.get("create_at", 0)
        dt = datetime.fromtimestamp(ts / 1000, tz=TZ_SHANGHAI)
        time_str = dt.strftime("%H:%M")
        user_id = p.get("user_id", "")
        msg = p.get("message", "").strip()

        if user_id == DADDY_USER_ID:
            speaker = "Daddy"
        elif user_id == bot_info["id"]:
            speaker = bot_info["username"]
        else:
            speaker = f"user:{user_id[:8]}"

        lines.append(f"[{time_str}] {speaker}: {msg}")

    return "\n".join(lines)


# ====================================================================
# Cursor management (incremental collection)
# ====================================================================

def _raw_dir(date_str: str) -> str:
    return os.path.join(DATA_DIR, "raw", date_str)


def _cursor_path(date_str: str) -> str:
    return os.path.join(_raw_dir(date_str), "_cursor.json")


def _load_cursor(date_str: str) -> dict:
    path = _cursor_path(date_str)
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return {}


def _save_cursor(date_str: str, cursor: dict):
    path = _cursor_path(date_str)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(cursor, f)


def _load_cached_posts(date_str: str) -> dict:
    raw = _raw_dir(date_str)
    cached = {}
    if not os.path.isdir(raw):
        return cached
    for fname in os.listdir(raw):
        if fname.startswith("_") or not fname.endswith(".json"):
            continue
        username = fname[:-5]
        fpath = os.path.join(raw, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        cached[username] = data
    return cached


def _merge_posts(cached_posts: list, new_posts: list) -> list:
    by_id = {}
    for p in cached_posts:
        pid = p.get("id")
        if pid:
            by_id[pid] = p
    for p in new_posts:
        pid = p.get("id")
        if pid:
            by_id[pid] = p
    return sorted(by_id.values(), key=lambda p: p.get("create_at", 0))


# ====================================================================
# Main collection entry point
# ====================================================================

def collect_daily_data(date_str: str, full: bool = False) -> dict:
    """
    Main collection function (supports incremental mode).

    Returns: {bot_username: {bot_info, raw_posts, filtered_posts, formatted_text, message_count, ...}}
    """
    date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=TZ_SHANGHAI)
    day_start_ms = int(date.timestamp()) * 1000
    until_ms = int((date + timedelta(days=1)).timestamp()) * 1000

    cursor = {} if full else _load_cursor(date_str)
    cached = {} if full else _load_cached_posts(date_str)
    is_incremental = bool(cursor) and not full

    if is_incremental:
        print(f"📡 增量采集 {date_str}（从上次 cursor 继续）...")
    else:
        print(f"📡 全量采集 {date_str} 的聊天记录...")
    print(f"   时间范围: {day_start_ms} - {until_ms}")

    bots = get_all_bot_users()
    print(f"   找到 {len(bots)} 个 bot 用户")

    results = {}
    new_cursor = {}

    for bot in bots:
        username = bot["username"]
        print(f"\n   🤖 {bot['emoji']} {username}...", end="")

        channel_id = get_dm_channel(bot["id"])
        if not channel_id:
            print(f" ❌ 无 DM channel")
            continue

        bot_cursor = cursor.get(username, {}).get("last_create_at", 0)
        if is_incremental and bot_cursor > 0:
            since_ms = bot_cursor + 1
        else:
            since_ms = day_start_ms

        try:
            new_posts = get_posts_since(channel_id, since_ms)
        except Exception as e:
            print(f" ⚠️ 拉取失败: {e}")
            if username in cached:
                print(f" (使用缓存 {len(cached[username].get('posts', []))} 条)")
            continue

        new_posts = [p for p in new_posts if day_start_ms <= p.get("create_at", 0) < until_ms]

        cached_bot_posts = []
        if username in cached and "posts" in cached[username]:
            cached_bot_posts = cached[username]["posts"]

        if is_incremental:
            all_raw_posts = _merge_posts(cached_bot_posts, new_posts)
            new_count = len(all_raw_posts) - len(cached_bot_posts)
            if new_count > 0:
                print(f" +{new_count} 新消息（总 {len(all_raw_posts)}）")
            elif new_posts:
                print(f" 0 新消息（总 {len(all_raw_posts)}）")
            else:
                print(f" 无新消息（总 {len(all_raw_posts)}）")
        else:
            all_raw_posts = new_posts
            print(f" {len(all_raw_posts)} 条")

        if not all_raw_posts:
            print(f"      📭 无消息")
            continue

        max_ts = max(p.get("create_at", 0) for p in all_raw_posts)
        new_cursor[username] = {"last_create_at": max_ts, "count": len(all_raw_posts)}

        filtered = filter_posts(all_raw_posts)
        if not filtered:
            continue

        daddy_count = sum(1 for p in filtered if p.get("user_id") == DADDY_USER_ID)
        bot_count = len(filtered) - daddy_count

        formatted = format_posts_for_llm(filtered, bot)

        times = [p.get("create_at", 0) for p in filtered]
        first = datetime.fromtimestamp(min(times) / 1000, tz=TZ_SHANGHAI).strftime("%H:%M")
        last = datetime.fromtimestamp(max(times) / 1000, tz=TZ_SHANGHAI).strftime("%H:%M")

        results[username] = {
            "bot_info": bot,
            "channel_id": channel_id,
            "raw_posts": all_raw_posts,
            "filtered_posts": filtered,
            "formatted_text": formatted,
            "message_count": {"daddy": daddy_count, "bot": bot_count, "total": len(filtered)},
            "active_hours": f"{first} - {last}",
        }

    _save_cursor(date_str, new_cursor)

    mode_str = "增量" if is_incremental else "全量"
    print(f"\n✅ {mode_str}采集完成: {len(results)} 个 bot 有活跃对话")
    return results


def save_raw_backup(date_str: str, data: dict):
    """Save filtered post data as local JSON backup."""
    raw = _raw_dir(date_str)
    os.makedirs(raw, exist_ok=True)

    for username, bot_data in data.items():
        filepath = os.path.join(raw, f"{username}.json")
        backup = {
            "bot_info": bot_data["bot_info"],
            "channel_id": bot_data["channel_id"],
            "message_count": bot_data["message_count"],
            "active_hours": bot_data["active_hours"],
            "posts": [
                {
                    "id": p.get("id"),
                    "user_id": p.get("user_id"),
                    "message": p.get("message"),
                    "create_at": p.get("create_at"),
                    "type": p.get("type"),
                }
                for p in bot_data["filtered_posts"]
            ],
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(backup, f, ensure_ascii=False, indent=2)

    print(f"💾 原始记录备份到 {raw}/")


if __name__ == "__main__":
    import sys
    date = sys.argv[1] if len(sys.argv) > 1 else datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d")
    data = collect_daily_data(date)
    save_raw_backup(date, data)
    for username, d in data.items():
        print(f"\n{'=' * 50}")
        print(f"{d['bot_info']['emoji']} {username}: {d['message_count']} 消息, 活跃 {d['active_hours']}")
        print(d["formatted_text"][:500])
