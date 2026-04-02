"""
Project status analysis (v2) — with LLM matching + historical context.

Pipeline stage L3:
  1. LLM-match aggregated tasks → projects
  2. Generate per-project status updates with history
  3. Push status updates to Supabase (with 30-min cooldown lock)
"""

import json
import os
import time as _time
from datetime import datetime, timezone, timedelta

from config import L1_BASE_URL, L1_API_KEY, DATA_DIR
from pipeline.llm import call_llm, parse_json_response
from push.supabase import supabase_request, resolve_agent_id, SUPABASE_SERVICE_KEY, SUPABASE_REST

CST = timezone(timedelta(hours=8))
L3_MODEL = "gpt-5.4"

LOCK_FILE = os.path.join(DATA_DIR, ".push_lock")
LOCK_COOLDOWN = 1800  # 30 minutes


# ====================================================================
# Cooldown lock
# ====================================================================

def _check_push_lock() -> bool:
    """Return True if we can push (cooldown elapsed)."""
    if not os.path.exists(LOCK_FILE):
        return True
    try:
        with open(LOCK_FILE, "r") as f:
            last_ts = float(f.read().strip())
        elapsed = _time.time() - last_ts
        if elapsed < LOCK_COOLDOWN:
            mins = int((LOCK_COOLDOWN - elapsed) / 60)
            print(f"  🔒 推送冷却中（还需 {mins} 分钟），跳过通知")
            return False
        return True
    except Exception:
        return True


def _set_push_lock():
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    with open(LOCK_FILE, "w") as f:
        f.write(str(_time.time()))


# ====================================================================
# LLM wrapper
# ====================================================================

def _call_l3(messages: list, model: str | None = None, max_retries: int = 3) -> str:
    return call_llm(
        messages,
        model=model or L3_MODEL,
        base_url=L1_BASE_URL,
        api_key=L1_API_KEY,
        timeout=180,
        max_retries=max_retries,
        temperature=0.2,
        max_tokens=8000,
        use_completion_tokens=True,
    )


# ====================================================================
# Step 1: LLM matching — assign tasks to projects
# ====================================================================

MATCH_PROMPT = """你是项目匹配专家。下面有两组数据：
1. 今天各 bot 完成的任务列表
2. 已知的项目列表

请判断每个任务属于哪个项目。

匹配规则：
- 只有任务内容**明确与项目相关**才匹配。关键看任务的具体内容，不要仅凭 bot 名称匹配
- 一个任务只能属于一个项目（选最相关的）
- 如果任务跟任何项目都不相关，归为 "unmatched"
- 运维类任务（/status、ping、模型切换、OpenClaw 版本升级、gateway 重启等）归为 "unmatched"
- ⚠️ 不同项目的任务不能混在一起！例如"帮 X 项目关服务器"只属于 X 项目，不属于其他项目
- ⚠️ "OpenClaw 基础设施维护"（模型切换、插件安装、provider 配置、代理排障、记忆插件管理、服务器状态检查、权限配置）是通用运维，不属于任何特定项目，必须归为 "unmatched"
- ⚠️ 基于 OpenClaw 构建的项目（如 ClawCraft）只接受**直接开发该项目功能**的任务，不接受通用 OpenClaw 平台运维任务

输出严格 JSON 数组：
[
  {
    "task_id": "bot_username#任务序号（从0开始）",
    "project_name": "匹配到的项目名 或 unmatched",
    "confidence": "high|medium|low",
    "reason": "简短说明匹配理由（10字内）"
  }
]"""


def match_events_to_projects(l1_results: dict, agg_tasks: dict, projects: list) -> dict:
    """LLM-match aggregated tasks to projects."""
    print("\n🔍 LLM 智能匹配任务到项目...")

    all_tasks = []
    task_index = {}
    for bot, tasks in agg_tasks.items():
        for i, task in enumerate(tasks):
            tid = f"{bot}#{i}"
            all_tasks.append({
                "task_id": tid,
                "bot": bot,
                "title": task.get("title", ""),
                "summary": task.get("summary", ""),
                "status": task.get("status", ""),
            })
            task_index[tid] = task
            task_index[tid]["bot"] = bot

    if not all_tasks:
        print("  ℹ️ 没有任务需要匹配")
        return {}

    project_list = [
        {"name": p.get("name", ""), "description": p.get("description", "")[:100]}
        for p in projects
    ]

    user_msg = f"""任务列表（共 {len(all_tasks)} 个）：
{json.dumps(all_tasks, ensure_ascii=False, indent=2)}

项目列表（共 {len(project_list)} 个）：
{json.dumps(project_list, ensure_ascii=False, indent=2)}"""

    messages = [
        {"role": "system", "content": MATCH_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    response = _call_l3(messages)
    matches = parse_json_response(response)

    if not matches or not isinstance(matches, list):
        print("  ⚠️ 匹配结果解析失败，回退到空匹配")
        return {}

    matched = {}
    match_count = 0
    unmatched_count = 0

    for m in matches:
        tid = m.get("task_id", "")
        pname = m.get("project_name", "unmatched")
        confidence = m.get("confidence", "low")

        if pname == "unmatched" or confidence == "low":
            unmatched_count += 1
            continue

        task = task_index.get(tid)
        if not task:
            continue

        if pname not in matched:
            matched[pname] = []

        matched[pname].append({
            "bot": task.get("bot", "?"),
            "content": task.get("title", task.get("summary", "")),
            "summary": task.get("summary", ""),
            "status": task.get("status", ""),
            "time_range": task.get("time_range", ""),
            "confidence": confidence,
        })
        match_count += 1

    print(f"  ✅ {match_count} 个任务匹配到 {len(matched)} 个项目，{unmatched_count} 个未匹配")
    return matched


# ====================================================================
# Step 2: Project status analysis
# ====================================================================

INSIGHT_PROMPT = """你是项目状态分析师。根据今天的任务数据和项目的历史状态，生成简洁的状态更新。

对每个项目，你需要输出 4 个字段：
1. project_name: 项目名称（必须与输入中的 ## 标题完全一致，一字不差）
2. current_summary: 一句话描述当前进展（30字以内，聚焦"做到哪了"）
3. next_action: 建议的下一步操作（30字以内，写清谁做什么，要具体可执行）
4. health: 项目健康度判断

health 判断规则（严格）：
- "healthy": 今天有 completed 的任务，项目在正常推进
- "attention": 有 in_progress 或 dropped 的任务，但不阻塞
- "blocked": 有明确的阻塞因素 — 必须是**当前仍未解决**的问题。如果任务状态是 completed，绝对不能标 blocked
- "stale": 今天没有实质性活动

⚠️ 关键规则：
- project_name 必须原样复制项目标题，不能改写或缩写
- 如果一个任务 status=completed，说明已经完成了，不能标 blocked 或 attention
- current_summary 写"做到哪了"，不是"做了什么"
- next_action 必须是具体可执行的步骤，不是空话
- 参考项目的历史状态，做增量更新。如果历史已经是 healthy 且今天也正常，保持 healthy

输出严格 JSON 数组格式：
[{"project_name": "项目名", "current_summary": "...", "next_action": "...", "health": "healthy|attention|blocked|stale"}]"""


def generate_project_insights(
    l1_results: dict,
    matched_projects: dict,
    all_projects: list,
    date_str: str,
) -> list:
    """Generate per-project status updates with historical context."""
    print("\n🔍 生成项目状态更新（v2 带历史上下文）...")

    if not matched_projects:
        print("  ℹ️ 今天没有项目活动")
        return []

    # Pull historical status from Supabase
    project_history = {}
    try:
        sb_projects = supabase_request(
            "AP_projects?status=neq.dismissed&select=name,metadata",
            None, method="GET"
        )
        if sb_projects:
            for p in sb_projects:
                meta = p.get("metadata") or {}
                project_history[p["name"]] = {
                    "last_summary": meta.get("current_summary", ""),
                    "last_health": meta.get("health", ""),
                    "last_next_action": meta.get("next_action", ""),
                    "last_active": meta.get("last_active", ""),
                }
    except Exception as e:
        print(f"  ⚠️ 拉取历史状态失败: {e}")

    events_text = ""
    for pname, events in matched_projects.items():
        history = project_history.get(pname, {})
        events_text += f"\n## {pname}\n"
        if history.get("last_summary"):
            events_text += f"上次状态: [{history['last_health']}] {history['last_summary']}\n"
            events_text += f"上次下一步: {history['last_next_action']}\n"
            events_text += f"上次活跃: {history['last_active']}\n"
        events_text += "今天的任务:\n"
        for e in events[:15]:
            bot = e.get("bot", "?")
            status = e.get("status", "")
            content = e.get("content", "")
            summary = e.get("summary", "")
            line = f"- [{bot}] [{status}] {content}"
            if summary and summary != content:
                line += f" — {summary[:80]}"
            events_text += line + "\n"

    messages = [
        {"role": "system", "content": INSIGHT_PROMPT},
        {"role": "user", "content": f"日期: {date_str}\n\n{events_text}\n\n输出 JSON 数组："},
    ]

    print(f"  📊 {len(matched_projects)} 个项目有今天的活动")
    response = _call_l3(messages)
    updates = parse_json_response(response)

    if not updates or not isinstance(updates, list):
        print(f"  ⚠️ 无法解析 LLM 响应")
        return []

    project_names = list(matched_projects.keys())
    for i, u in enumerate(updates):
        pname = u.get("project_name", "")
        if not pname or pname == "?" or pname not in matched_projects:
            if i < len(project_names):
                u["project_name"] = project_names[i]
                print(f"    ⚠️ 修正项目名: {pname!r} → {project_names[i]}")

    print(f"  ✅ 生成 {len(updates)} 个项目状态更新")
    return updates


# ====================================================================
# Step 3: Push to Supabase
# ====================================================================

def build_recent_events(l1_results: dict, project_name: str,
                        matched_events: list, date_str: str) -> list:
    events = []
    for e in matched_events[:10]:
        events.append({
            "date": date_str,
            "event": e.get("content", e.get("title", ""))[:100],
            "bot": e.get("bot", "?"),
            "status": e.get("status", ""),
        })
    return events


def push_project_insights(updates: list, matched_projects: dict,
                           all_projects: list, l1_results: dict, date_str: str):
    """Push project status updates to Supabase (with cooldown lock)."""
    can_notify = _check_push_lock()

    print(f"\n📤 推送项目状态更新...")

    name_to_project = {}
    for p in all_projects:
        name_to_project[p.get("name", "")] = p

    success = 0
    for update in updates:
        pname = update.get("project_name", "")
        project = name_to_project.get(pname)
        if not project:
            for n, p in name_to_project.items():
                if pname in n or n in pname:
                    project = p
                    break
            if not project:
                print(f"  ⚠️ 找不到项目: {pname}")
                continue

        events = matched_projects.get(pname, [])
        recent = build_recent_events(l1_results, pname, events, date_str)

        existing_recent = project.get("metadata", {}).get("recent_events", [])
        if isinstance(existing_recent, list):
            all_recent = existing_recent + recent
        else:
            all_recent = recent
        all_recent = all_recent[-20:]

        metadata = project.get("metadata", {})
        metadata["recent_events"] = all_recent
        metadata["last_active"] = date_str
        metadata["current_summary"] = update.get("current_summary", "")
        metadata["next_action"] = update.get("next_action", "")
        metadata["health"] = update.get("health", "healthy")
        metadata["last_digest_update"] = datetime.now(CST).isoformat()

        patch = {
            "metadata": metadata,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        pid = project.get("id", "")
        if not pid:
            print(f"  ⚠️ {pname}: 无 project id，跳过 PATCH")
            continue

        import urllib.request
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        try:
            req = urllib.request.Request(
                f"{SUPABASE_REST}/AP_projects?id=eq.{pid}",
                data=json.dumps(patch).encode(),
                headers=headers,
                method="PATCH",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
                if not body:
                    print(f"  ⚠️ {pname}: PATCH 返回空（id={pid[:8]}... 未匹配到行）")
                    continue
            print(f"  ✅ {pname}: {update.get('health', '?')} — {update.get('current_summary', '')[:40]}")
            success += 1
        except Exception as e:
            print(f"  ❌ {pname}: {e}")

    print(f"  📊 更新了 {success}/{len(updates)} 个项目")

    if can_notify:
        _set_push_lock()

    return can_notify


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now(CST).strftime("%Y-%m-%d"))
    args = parser.parse_args()

    from pipeline.project_tracker import load_cache

    cache = load_cache()
    projects = cache.get("projects", [])

    raw_dir = os.path.join(DATA_DIR, "raw")
    with open(f"{raw_dir}/{args.date}/_l1_results.json") as f:
        l1 = json.load(f)

    try:
        with open(f"{raw_dir}/{args.date}/_aggregated_tasks.json") as f:
            agg_tasks = json.load(f)
    except FileNotFoundError:
        agg_tasks = {}

    matched = match_events_to_projects(l1, agg_tasks, projects)
    updates = generate_project_insights(l1, matched, projects, args.date)
    if updates:
        push_project_insights(updates, matched, projects, l1, args.date)
