"""
Project discovery and incremental matching (v3).

Identifies and tracks projects from L1 events:
1. Full discovery from historical L1 data (one-time init)
2. Incremental matching: new events → existing projects or new projects
3. Automatic project merging
4. Local cache + Supabase sync
"""

import json
import os
import sys
import uuid
import time
from datetime import datetime, timezone, timedelta

from config import (
    L1_BASE_URL, L1_API_KEY, L1_MODEL,
    SUPABASE_REST, SUPABASE_SERVICE_KEY,
    DATA_DIR,
)
from pipeline.llm import call_llm, parse_json_response

TZ_SHANGHAI = timezone(timedelta(hours=8))
RAW_DIR = os.path.join(DATA_DIR, "raw")
CACHE_PATH = os.path.join(RAW_DIR, "_projects_cache.json")

# ====================================================================
# Prompts
# ====================================================================

PROJECT_DISCOVERY_PROMPT = """你是一个项目分析师。从以下 L1 事件摘要中识别所有"项目"。

项目定义（满足其一即可）：
- 有一定规模的工作（涉及多步、多文件、或多个子任务）
- 有明确的目标或产出物（代码仓库、网站、服务、工具、文档等）
- 涉及部署、开发、调试某个系统或产品
- 跨天工作或同一天内超过 5 条相关事件
- 例如："薯条平台"、"小红书发布功能"、"Daily Digest 流水线"、"Agent Portal"、"wx-sync 微信小程序"、"BNEF 活动管理平台"、"服务器健康检查系统"、"memory-lancedb-pro 记忆插件"、"sing-box 代理配置"
- 不算项目的：单次回答问题、单次 ping/pong 测试、装一个小插件、改一个配置项

对每个项目，输出：
- name: 项目名（简洁中文）
- description: 一句话描述
- status: discovering | active | blocked | done | dormant
- involved_bots: 参与的 bot 列表
- primary_bot: 主要负责的 bot
- milestones: [{date, event, bot}] 关键里程碑
- next_actions: 推断的下一步行动
- deliverables: 已知产出物
- tags: 自动标签（如 infra, content, product, AI, web）
- first_seen: 最早出现日期
- last_active: 最近活跃日期

输出严格 JSON（不要 markdown 代码块）：
{
  "projects": [
    {
      "name": "项目名",
      "description": "一句话描述",
      "status": "active",
      "involved_bots": ["bot1", "bot2"],
      "primary_bot": "bot1",
      "milestones": [{"date": "2026-03-20", "event": "初版完成", "bot": "bot1"}],
      "next_actions": ["下一步1"],
      "deliverables": ["产出1"],
      "tags": ["infra"],
      "first_seen": "2026-03-20",
      "last_active": "2026-03-28"
    }
  ]
}"""

PROJECT_MATCH_PROMPT = """你是一个项目匹配分析师。将以下新事件匹配到已有项目，或识别新项目。

已有项目列表：
{existing_projects}

新事件（日期 {date}，bot: {bot}）：
{events_summary}

规则：
1. 如果事件明显属于某个已有项目 → matched（名称不需要完全一致，语义相关即可匹配）
2. 如果事件达到项目级别但不属于任何已有项目 → new_project
3. 如果只是小任务/bug修复/日常维护/一次性配置/装个插件/跑个脚本 → skip（不创建项目）
4. 如果两个已有项目明显是同一个 → 在 merges 中标记

⚠️ 创建新项目的门槛适中：
- 涉及多步操作、有明确目标或产出物的工作应该创建项目
- 跨天的工作、或同一天内有多条相关事件的工作应该创建项目
- "单次配置一个 key"、"回答一个问题"、"单次 ping" 不算项目
- 但 "部署一个服务"、"开发一个功能"、"搭建一个系统" 即使只出现一天也算项目
- 当不确定时，偏向创建项目而不是跳过

输出严格 JSON：
{{
  "matches": [
    {{
      "event_indices": [0, 1, 2],
      "project_name": "已有项目名",
      "milestone": "本次新的里程碑描述（如果有重要进展）",
      "status_update": "active|done|blocked|null",
      "new_deliverables": ["新产出"],
      "new_next_actions": ["新的下一步"]
    }}
  ],
  "new_projects": [
    {{
      "name": "新项目名",
      "description": "一句话描述",
      "involved_bots": ["{bot}"],
      "primary_bot": "{bot}",
      "tags": ["tag1"],
      "milestone": "首次发现的描述",
      "deliverables": [],
      "next_actions": []
    }}
  ],
  "merges": [
    {{
      "from_project": "被合并项目名",
      "into_project": "合并到项目名",
      "reason": "原因"
    }}
  ],
  "skipped_events": [3, 5]
}}"""


# ====================================================================
# Cache management
# ====================================================================

def load_cache() -> dict:
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"projects": [], "last_updated": None}


def save_cache(cache: dict):
    cache["last_updated"] = datetime.now(TZ_SHANGHAI).isoformat()
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def load_all_l1_results() -> dict:
    all_results = {}
    if not os.path.isdir(RAW_DIR):
        return all_results
    for date_dir in sorted(os.listdir(RAW_DIR)):
        if not date_dir.startswith("2026-"):
            continue
        l1_path = os.path.join(RAW_DIR, date_dir, "_l1_results.json")
        if os.path.exists(l1_path):
            with open(l1_path, "r", encoding="utf-8") as f:
                all_results[date_dir] = json.load(f)
    return all_results


# ====================================================================
# Discovery helpers
# ====================================================================

def summarize_events_for_discovery(all_l1: dict) -> str:
    lines = []
    for date_str in sorted(all_l1.keys()):
        day_data = all_l1[date_str]
        for username, l1 in day_data.items():
            events = l1.get("events", [])
            topic = l1.get("topic_summary", "")
            if not events and not topic:
                continue
            key_events = []
            for e in events:
                status = e.get("status", "")
                content = e.get("content", "")
                deliverables = e.get("deliverables", [])
                if status in ("completed", "in_progress") or deliverables:
                    key_events.append(content[:100])
            if topic or key_events:
                line = f"[{date_str}] {username}: {topic}"
                if key_events:
                    line += " | " + "; ".join(key_events[:5])
                lines.append(line)
    return "\n".join(lines)


def _call_discovery(summary_text: str) -> list[dict]:
    messages = [
        {"role": "system", "content": PROJECT_DISCOVERY_PROMPT},
        {"role": "user", "content": f"以下是所有 bot 与 Daddy 的聊天事件摘要：\n\n{summary_text}"},
    ]
    for attempt in range(2):
        try:
            raw = call_llm(messages, model=L1_MODEL, base_url=L1_BASE_URL,
                           api_key=L1_API_KEY, timeout=180, max_tokens=16384)
            result = parse_json_response(raw)
            if result and isinstance(result, dict):
                return result.get("projects", [])
        except Exception as e:
            print(f"   ⚠️ 发现失败 (attempt {attempt + 1}): {e}")
            if attempt == 0:
                time.sleep(5)
    return []


def _deduplicate_projects(projects: list[dict]) -> list[dict]:
    seen = {}
    for p in projects:
        name = p.get("name", "")
        if name in seen:
            existing = seen[name]
            existing["milestones"] = existing.get("milestones", []) + p.get("milestones", [])
            existing["involved_bots"] = list(set(
                existing.get("involved_bots", []) + p.get("involved_bots", [])))
            if p.get("last_active", "") > existing.get("last_active", ""):
                existing["last_active"] = p["last_active"]
                existing["status"] = p.get("status", existing.get("status"))
            existing["deliverables"] = list(set(
                existing.get("deliverables", []) + p.get("deliverables", [])))
        else:
            seen[name] = p
    return list(seen.values())


def discover_projects_from_history(all_l1: dict) -> list[dict]:
    print("🔍 正在从历史事件中发现项目...")
    summary = summarize_events_for_discovery(all_l1)
    print(f"   摘要长度: {len(summary)} chars")

    MAX_CHARS = 60000
    if len(summary) > MAX_CHARS:
        chunks = []
        lines = summary.split("\n")
        current = []
        current_len = 0
        for line in lines:
            if current_len + len(line) > MAX_CHARS and current:
                chunks.append("\n".join(current))
                current = []
                current_len = 0
            current.append(line)
            current_len += len(line) + 1
        if current:
            chunks.append("\n".join(current))

        print(f"   分 {len(chunks)} 片处理")
        all_projects = []
        for i, chunk in enumerate(chunks):
            print(f"   处理第 {i + 1}/{len(chunks)} 片...")
            projects = _call_discovery(chunk)
            all_projects.extend(projects)
            time.sleep(2)
        return _deduplicate_projects(all_projects)
    else:
        return _call_discovery(summary)


# ====================================================================
# Incremental matching
# ====================================================================

def match_events_to_projects(events: list[dict], bot_username: str,
                              date_str: str, existing_projects: list[dict]) -> dict:
    if not events:
        return {"matches": [], "new_projects": [], "merges": [], "skipped_events": []}

    proj_summary = json.dumps([
        {"name": p["name"], "description": p.get("description", ""),
         "status": p.get("status", ""), "involved_bots": p.get("involved_bots", []),
         "tags": p.get("tags", [])}
        for p in existing_projects
    ], ensure_ascii=False)

    events_summary = "\n".join([
        f"[{i}] {e.get('time', '')} {e.get('content', '')[:150]} (status: {e.get('status', '')})"
        for i, e in enumerate(events)
    ])

    prompt = PROJECT_MATCH_PROMPT.format(
        existing_projects=proj_summary,
        date=date_str,
        bot=bot_username,
        events_summary=events_summary,
    )

    messages = [
        {"role": "system", "content": "你是项目匹配分析师。输出严格 JSON。"},
        {"role": "user", "content": prompt},
    ]

    for attempt in range(2):
        try:
            raw = call_llm(messages, model=L1_MODEL, base_url=L1_BASE_URL,
                           api_key=L1_API_KEY, timeout=180, max_tokens=16384)
            result = parse_json_response(raw)
            if result and isinstance(result, dict):
                return result
        except Exception as e:
            print(f"   ⚠️ 匹配失败 (attempt {attempt + 1}): {e}")
            if attempt == 0:
                time.sleep(3)

    return {"matches": [], "new_projects": [], "merges": [],
            "skipped_events": list(range(len(events)))}


def apply_match_results(cache: dict, match_result: dict,
                        date_str: str, bot_username: str) -> dict:
    projects = cache.get("projects", [])
    proj_by_name = {p["name"]: p for p in projects}

    for match in match_result.get("matches", []):
        pname = match.get("project_name", "")
        if pname not in proj_by_name:
            continue
        proj = proj_by_name[pname]
        is_curated = proj.get("curated", False)

        if date_str > proj.get("last_active", ""):
            proj["last_active"] = date_str

        milestone = match.get("milestone")
        if milestone:
            proj.setdefault("milestones", []).append({
                "date": date_str, "event": milestone, "bot": bot_username
            })

        if is_curated:
            continue

        if proj.get("status") == "candidate" and date_str != proj.get("first_seen", ""):
            proj["status"] = "discovering"

        if bot_username not in proj.get("involved_bots", []):
            proj.setdefault("involved_bots", []).append(bot_username)

        status_update = match.get("status_update")
        if status_update and status_update != "null":
            proj["status"] = status_update

        for d in match.get("new_deliverables", []):
            if d and d not in proj.get("deliverables", []):
                proj.setdefault("deliverables", []).append(d)

        new_actions = match.get("new_next_actions", [])
        if new_actions:
            proj["next_actions"] = new_actions

    for new_proj in match_result.get("new_projects", []):
        name = new_proj.get("name", "")
        if not name or name in proj_by_name:
            continue
        project = {
            "id": str(uuid.uuid4()),
            "name": name,
            "description": new_proj.get("description", ""),
            "status": "active",
            "first_seen": date_str,
            "last_active": date_str,
            "involved_bots": new_proj.get("involved_bots", [bot_username]),
            "primary_bot": new_proj.get("primary_bot", bot_username),
            "milestones": [{"date": date_str, "event": new_proj.get("milestone", "首次发现"), "bot": bot_username}],
            "next_actions": new_proj.get("next_actions", []),
            "deliverables": new_proj.get("deliverables", []),
            "tags": new_proj.get("tags", []),
            "auto_generated": True,
        }
        projects.append(project)
        proj_by_name[name] = project

    for merge in match_result.get("merges", []):
        from_name = merge.get("from_project", "")
        into_name = merge.get("into_project", "")
        if from_name in proj_by_name and into_name in proj_by_name:
            from_proj = proj_by_name[from_name]
            into_proj = proj_by_name[into_name]
            into_proj["milestones"] = into_proj.get("milestones", []) + from_proj.get("milestones", [])
            into_proj["involved_bots"] = list(set(
                into_proj.get("involved_bots", []) + from_proj.get("involved_bots", [])))
            into_proj["deliverables"] = list(set(
                into_proj.get("deliverables", []) + from_proj.get("deliverables", [])))
            if from_proj.get("first_seen", "") < into_proj.get("first_seen", "9999"):
                into_proj["first_seen"] = from_proj["first_seen"]
            from_proj["merged_into"] = into_proj.get("id", "")
            from_proj["status"] = "merged"

    cache["projects"] = [p for p in projects if p.get("status") != "merged"]
    return cache


def _sync_curated_flags(cache: dict):
    try:
        from push.db import db_select
        resp = db_select("AP_projects", columns="id, metadata")
        if resp:
            curated_ids = set()
            for p in resp:
                meta = p.get("metadata") or {}
                if isinstance(meta, str):
                    meta = json.loads(meta)
                if meta.get("curated"):
                    curated_ids.add(p["id"])
            for p in cache.get("projects", []):
                if p.get("id") in curated_ids:
                    p["curated"] = True
    except Exception as e:
        print(f"  ⚠️ curated 同步失败（不阻塞）: {e}")


def run_incremental_matching(cache: dict, l1_results: dict, date_str: str) -> dict:
    _sync_curated_flags(cache)

    for username, l1 in l1_results.items():
        events = l1.get("events", [])
        if not events:
            continue
        match_result = match_events_to_projects(
            events, username, date_str, cache.get("projects", []))
        cache = apply_match_results(cache, match_result, date_str, username)
        time.sleep(0.5)

    return cache


def update_dormant_status(cache: dict, current_date: str | None = None) -> dict:
    if not current_date:
        current_date = datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d")
    current = datetime.strptime(current_date, "%Y-%m-%d")
    for p in cache.get("projects", []):
        if p.get("status") in ("done", "dormant", "merged", "candidate"):
            continue
        last = p.get("last_active", "")
        if last:
            last_dt = datetime.strptime(last, "%Y-%m-%d")
            if (current - last_dt).days >= 7:
                p["status"] = "dormant"
    return cache


def discover_and_build_cache(force: bool = False) -> dict:
    cache = load_cache()
    if cache.get("projects") and not force:
        print(f"⏭️ 已有 {len(cache['projects'])} 个项目缓存，跳过发现（用 --force 强制重跑）")
        return cache

    all_l1 = load_all_l1_results()
    if not all_l1:
        print("📭 无 L1 结果，无法发现项目")
        return cache

    print(f"📊 加载 {len(all_l1)} 天的 L1 结果")
    projects = discover_projects_from_history(all_l1)

    for p in projects:
        if "id" not in p:
            p["id"] = str(uuid.uuid4())
        p["auto_generated"] = True

    cache["projects"] = projects
    print(f"✅ 发现 {len(projects)} 个项目")

    print("\n🔄 增量匹配细化项目信息...")
    for date_str in sorted(all_l1.keys()):
        day_l1 = all_l1[date_str]
        cache = run_incremental_matching(cache, day_l1, date_str)
        print(f"  ✅ {date_str}: {len(cache['projects'])} 个项目")

    save_cache(cache)
    print(f"\n💾 项目缓存保存到 {CACHE_PATH}")
    return cache


def get_project_summary(cache: dict) -> str:
    projects = cache.get("projects", [])
    lines = []
    by_status = {}
    for p in projects:
        status = p.get("status", "unknown")
        by_status.setdefault(status, []).append(p)

    for status in ["active", "discovering", "blocked", "done", "dormant", "candidate"]:
        projs = by_status.get(status, [])
        if not projs:
            continue
        lines.append(f"\n## {status.upper()} ({len(projs)})")
        for p in projs:
            bots = ", ".join(p.get("involved_bots", [])[:3])
            ms_count = len(p.get("milestones", []))
            lines.append(
                f"  - **{p['name']}** [{bots}] {p.get('description', '')} "
                f"({p.get('first_seen', '?')} ~ {p.get('last_active', '?')}, "
                f"{ms_count} milestones)")

    return "\n".join(lines)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="项目发现与匹配")
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--match-date", type=str)
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--dormant-check", action="store_true")
    args = parser.parse_args()

    if args.discover:
        cache = discover_and_build_cache(force=args.force)
        print(get_project_summary(cache))
    elif args.match_date:
        cache = load_cache()
        l1_path = os.path.join(RAW_DIR, args.match_date, "_l1_results.json")
        if os.path.exists(l1_path):
            with open(l1_path, "r", encoding="utf-8") as f:
                l1 = json.load(f)
            cache = run_incremental_matching(cache, l1, args.match_date)
            save_cache(cache)
            print(get_project_summary(cache))
        else:
            print(f"❌ {l1_path} 不存在")
    elif args.summary:
        cache = load_cache()
        print(get_project_summary(cache))
    elif args.dormant_check:
        cache = load_cache()
        cache = update_dormant_status(cache)
        save_cache(cache)
        print("✅ Dormant 状态已更新")
    else:
        parser.print_help()
