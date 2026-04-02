"""
L1.5: Task aggregation.

Merges L1 fragment-level events into 5–10 coherent "tasks" per bot.
Each task has a title, status, time range, summary, and deliverables.
"""

import json

from config import L1_BASE_URL, L1_API_KEY, L1_MODEL
from pipeline.llm import call_llm, parse_json_response

AGGREGATION_PROMPT = """你是任务聚合器。下面是一个 bot 今天的所有结构化事件（碎片级别），请把它们聚合成 **5-10 个任务**。

聚合规则：
1. 相关的连续事件合并成一个"任务"（同一件事的请求→执行→完成→验证）
2. 每个任务要有清晰的一句话标题（不超过 20 字）
3. 把碎片的 references/deliverables 汇总到任务级别
4. ping/pong、/status、/model 等运维指令合并成一个"运维/闲聊"任务（如果有的话）
5. 如果某些事件确实独立（不同话题），保留为独立任务
6. 任务数量控制在 3-12 个，宁可少也不要碎

任务状态判定：
- completed: 所有子事件都完成了
- in_progress: 最后一个子事件还在进行中
- blocked: 有 no_response 或 promise_no_result 的 flag
- dropped: 有 dropped flag 或讨论了没做

输出严格 JSON（不要 markdown 代码块）：
{
  "tasks": [
    {
      "title": "任务标题（20字以内）",
      "status": "completed|in_progress|blocked|dropped",
      "time_range": "HH:MM - HH:MM",
      "summary": "一两句话说明做了什么、结果是什么",
      "deliverables": ["只写文件路径、URL链接、数据库表名等可访问物件，不要写描述性文字，无则空数组"],
      "event_count": 5
    }
  ]
}"""


def aggregate_tasks(bot_username: str, bot_emoji: str, l1_result: dict) -> list[dict]:
    """Aggregate L1 events into tasks for one bot."""
    events = l1_result.get("events", [])
    flags = l1_result.get("flags", [])

    if len(events) <= 3:
        return _events_to_tasks(events)

    print(f"  🔗 聚合 {bot_emoji} {bot_username}: {len(events)} 事件...")

    events_text = json.dumps(events, ensure_ascii=False)
    flags_text = json.dumps(flags, ensure_ascii=False) if flags else "[]"

    if len(events) > 60:
        trimmed = []
        for e in events:
            e2 = dict(e)
            if len(e2.get("detail", "")) > 100:
                e2["detail"] = e2["detail"][:100] + "..."
            trimmed.append(e2)
        events_text = json.dumps(trimmed, ensure_ascii=False)

    user_prompt = f"""Bot: {bot_emoji} {bot_username}
事件总数: {len(events)}
topic_summary: {l1_result.get('topic_summary', '无')}

事件列表:
{events_text}

Flags:
{flags_text}

请将以上事件聚合成任务。"""

    messages = [
        {"role": "system", "content": AGGREGATION_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        raw = call_llm(
            messages,
            model=L1_MODEL,
            base_url=L1_BASE_URL,
            api_key=L1_API_KEY,
            timeout=120,
            max_retries=2,
            temperature=0.1,
            max_tokens=4096,
        )
        parsed = parse_json_response(raw)
        if parsed and isinstance(parsed, dict):
            tasks = parsed.get("tasks", [])
            print(f"    ✅ {len(tasks)} 个任务")
            return tasks
    except Exception as e:
        print(f"    ⚠️ 聚合失败 ({e})，降级为简单分组")

    return _events_to_tasks(events)


def _events_to_tasks(events: list[dict]) -> list[dict]:
    """Fallback: convert each event directly to a task."""
    tasks = []
    for e in events:
        tasks.append({
            "title": e.get("content", "")[:20],
            "status": e.get("status", "info"),
            "time_range": e.get("time", ""),
            "summary": e.get("content", ""),
            "deliverables": e.get("deliverables", []),
            "event_count": 1,
        })
    return tasks


def aggregate_all(l1_results: dict) -> dict:
    """Run task aggregation on all bots' L1 results."""
    print(f"\n🔗 L1.5 开始任务聚合...")
    all_tasks = {}

    for username, l1_data in l1_results.items():
        emoji = l1_data.get("bot_emoji", "🤖")
        tasks = aggregate_tasks(username, emoji, l1_data)
        all_tasks[username] = tasks

    total = sum(len(t) for t in all_tasks.values())
    print(f"\n✅ L1.5 完成: {len(all_tasks)} 个 bot, 共 {total} 个任务")
    return all_tasks
