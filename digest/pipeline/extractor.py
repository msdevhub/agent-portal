"""
L1: Structured event extraction (gpt-4.1).

Converts each bot's chat transcript into a list of structured events.
Preserves all detail — no compression, no loss.
"""

import json

from config import L1_BASE_URL, L1_API_KEY, L1_MODEL, L1_FALLBACK
from pipeline.llm import call_llm, parse_json_response

L1_SYSTEM_PROMPT = """你是信息提取器。从以下 Mattermost 聊天记录中提取所有事件，不要遗漏任何一条。

提取规则：
1. 每一个 Daddy 发出的指令/请求/问题 → 必须记录
2. 每一个 bot 的承诺/动作/结果/回答 → 必须记录
3. 提到的文件路径、URL、数字、代码片段 → 原样保留在 references 中
4. 不要概括，不要合并，宁可多也不要少
5. 对话中的每个"转折点"（换话题/新任务）都要标记为新条目
6. 如果 Daddy 发了消息但 bot 没回复，action 标记为 "no_response"
7. 如果 bot 说"正在做/去处理"但之后无结果报告，在 flags 中标记为 "promise_no_result"
8. 如果 bot 说"完成了/好了"，在后续对话中检查是否真正完成
9. 每个事件提取"产出"(deliverables)：做了什么留下了什么痕迹？
   - 产出必须是**可访问的具体物件**，不要写描述性文字
   - 文件/代码创建或修改 → 写完整路径（如 /home/ottor/xxx/file.py）
   - URL/链接 → 写完整URL（如 https://xxx.com/page）
   - 数据库变更 → 写表名和操作（如 "AP_projects 表新增 3 行"）
   - 配置变更 → 写具体文件路径（如 ~/.openclaw/openclaw.json）
   - 图片/截图 → 写文件路径或URL
   - 纯讨论/排查/无具体物件产出 → 空数组 []
   - ⚠️ 不要写模糊的描述（如"架构设计方案"、"模型切换记录"），必须是路径或链接

状态标记规则：
- completed: 任务明确完成，有结果证据
- in_progress: 正在进行，未完成
- dropped: 提到了但没有后续跟进（如：早上说了，做了一部分，后来没跟进）
- promise_no_result: bot 承诺做但没有结果
- no_response: Daddy 发了消息但 bot 无回复
- info: 纯信息交流，不是任务

输出严格 JSON 格式（不要 markdown 代码块包裹）：
{
  "events": [
    {
      "time": "HH:MM",
      "who": "daddy|bot",
      "action": "request|response|completed|info|no_response",
      "content": "事件描述（中文）",
      "status": "completed|in_progress|dropped|promise_no_result|no_response|info",
      "detail": "补充细节（可选）",
      "references": ["文件路径或URL（可选）"],
      "deliverables": ["产出描述（可选，无产出则空数组）"]
    }
  ],
  "flags": [
    {
      "type": "promise_no_result|dropped|no_response",
      "description": "描述问题",
      "event_index": 0
    }
  ],
  "topic_summary": "一句话概括今天这个bot主要在做什么"
}"""


MAX_CHARS_PER_CHUNK = 40000  # ~10k tokens, safe for gpt-4.1/4o context


def _call_l1(messages: list[dict], model: str | None = None) -> str:
    """Call the L1 extraction model with fallback support."""
    return call_llm(
        messages,
        model=model or L1_MODEL,
        base_url=L1_BASE_URL,
        api_key=L1_API_KEY,
        timeout=180,
        max_retries=2,
        temperature=0.1,
        max_tokens=16384,
        fallback_model=L1_FALLBACK if (model or L1_MODEL) != L1_FALLBACK else None,
    )


def split_text_into_chunks(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> list[str]:
    """Split text into chunks at line boundaries."""
    lines = text.split("\n")
    chunks = []
    current_chunk = []
    current_len = 0

    for line in lines:
        line_len = len(line) + 1
        if current_len + line_len > max_chars and current_chunk:
            chunks.append("\n".join(current_chunk))
            current_chunk = []
            current_len = 0
        current_chunk.append(line)
        current_len += line_len

    if current_chunk:
        chunks.append("\n".join(current_chunk))

    return chunks


def merge_chunk_results(results: list[dict]) -> dict:
    """Merge extraction results from multiple chunks."""
    merged = {"events": [], "flags": [], "topic_summary": ""}
    summaries = []
    flag_offset = 0

    for r in results:
        events = r.get("events", [])
        merged["events"].extend(events)

        for flag in r.get("flags", []):
            flag = dict(flag)
            if "event_index" in flag:
                flag["event_index"] += flag_offset
            merged["flags"].append(flag)

        flag_offset += len(events)

        if r.get("topic_summary"):
            summaries.append(r["topic_summary"])

    if len(summaries) == 1:
        merged["topic_summary"] = summaries[0]
    elif summaries:
        merged["topic_summary"] = "；".join(summaries)

    return merged


def extract_single_chunk(bot_username: str, formatted_text: str,
                         message_count: dict, active_hours: str,
                         chunk_idx: int = 0, total_chunks: int = 1) -> dict:
    """Extract events from a single text chunk."""
    chunk_info = ""
    if total_chunks > 1:
        chunk_info = f"\n\n注意：这是第 {chunk_idx + 1}/{total_chunks} 部分对话，请提取这一部分中的所有事件。"

    user_prompt = f"""以下是 Daddy 与 {bot_username} 在 Mattermost 上的聊天记录。
请提取所有事件。

统计信息：
- Daddy 消息数: {message_count['daddy']}
- Bot 消息数: {message_count['bot']}
- 活跃时段: {active_hours}{chunk_info}

聊天记录：
{formatted_text}"""

    messages = [
        {"role": "system", "content": L1_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    import time as _time

    for attempt in range(2):
        try:
            raw_response = _call_l1(messages)
        except Exception as e:
            print(f"    ⚠️ Chunk {chunk_idx + 1} LLM 调用失败 (attempt {attempt + 1}): {e}")
            if attempt == 0:
                _time.sleep(5)
                continue
            raw_response = ""

        result = parse_json_response(raw_response)
        if result and isinstance(result, dict):
            return result

        if attempt == 0:
            print(f"    ⚠️ Chunk {chunk_idx + 1} JSON 解析失败，重试...")
            _time.sleep(3)
            continue
        print(f"    ⚠️ Chunk {chunk_idx + 1} JSON 解析最终失败，跳过")
        print(f"    ⚠️ 原始前 300 字符: {raw_response[:300]}")

    return {
        "events": [{
            "time": "00:00", "who": "system", "action": "error",
            "content": f"L1 Chunk {chunk_idx + 1} JSON 解析失败",
            "status": "info",
            "detail": raw_response[:500] if raw_response else "(empty)",
            "deliverables": [],
        }],
        "flags": [],
        "topic_summary": "解析失败",
    }


def extract_events(bot_username: str, bot_emoji: str, formatted_text: str,
                    message_count: dict, active_hours: str) -> dict:
    """L1: Extract structured events from a bot's formatted chat transcript."""
    print(f"  🔍 L1 提取 {bot_emoji} {bot_username}...")

    chunks = split_text_into_chunks(formatted_text)

    if len(chunks) == 1:
        result = extract_single_chunk(bot_username, formatted_text,
                                       message_count, active_hours)
    else:
        print(f"    📦 消息过长，分 {len(chunks)} 片处理...")
        chunk_results = []
        for i, chunk in enumerate(chunks):
            print(f"    📦 处理第 {i + 1}/{len(chunks)} 片...")
            r = extract_single_chunk(bot_username, chunk, message_count,
                                      active_hours, i, len(chunks))
            chunk_results.append(r)
        result = merge_chunk_results(chunk_results)

    result["bot_id"] = bot_username
    result["bot_emoji"] = bot_emoji
    result["message_count"] = message_count
    result["active_hours"] = active_hours

    event_count = len(result.get("events", []))
    flag_count = len(result.get("flags", []))
    print(f"    ✅ 提取 {event_count} 个事件, {flag_count} 个标记")

    return result


def extract_all(collected_data: dict) -> dict:
    """Run L1 extraction on all collected bot data."""
    print(f"\n🔍 L1 开始结构化提取 ({L1_MODEL})...")
    results = {}

    for username, data in collected_data.items():
        bot = data["bot_info"]
        result = extract_events(
            bot_username=username,
            bot_emoji=bot["emoji"],
            formatted_text=data["formatted_text"],
            message_count=data["message_count"],
            active_hours=data["active_hours"],
        )
        results[username] = result

    print(f"\n✅ L1 完成: {len(results)} 个 bot 提取完毕")
    return results
