"""
Shared LLM calling and JSON parsing utilities.

Consolidates call_llm / parse_json_response used by extractor and project_insights.
"""

import json
import time
import urllib.request


def call_llm(messages: list[dict], model: str, base_url: str, api_key: str,
             timeout: int = 180, max_retries: int = 2, temperature: float = 0.1,
             max_tokens: int = 16384, use_completion_tokens: bool = False,
             fallback_model: str = None) -> str:
    """
    Call Azure Foundry OpenAI-compatible chat completions API.

    Args:
        use_completion_tokens: If True, use max_completion_tokens instead of max_tokens
                               (required for gpt-5.x series).
        fallback_model: If set, retry with this model on non-timeout errors.
    """
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if use_completion_tokens:
        payload["max_completion_tokens"] = max_tokens
    else:
        payload["max_tokens"] = max_tokens

    for attempt in range(max_retries):
        req = urllib.request.Request(
            f"{base_url}chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read())
                return result["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                wait = int(e.headers.get("Retry-After", 30))
                print(f"    ⏳ 429 限流，等待 {wait}s 后重试...")
                time.sleep(wait)
                continue
            if attempt == 0 and fallback_model and model != fallback_model:
                print(f"    ⚠️ {model} 失败 ({e})，尝试 fallback {fallback_model}...")
                return call_llm(messages, fallback_model, base_url, api_key,
                                timeout, max_retries, temperature, max_tokens,
                                use_completion_tokens)
            raise
        except Exception as e:
            if attempt == 0:
                if "timed out" in str(e).lower() or "timeout" in str(e).lower():
                    print(f"    ⚠️ {model} 超时，重试...")
                    time.sleep(3)
                    continue
                if fallback_model and model != fallback_model:
                    print(f"    ⚠️ {model} 失败 ({e})，尝试 fallback {fallback_model}...")
                    return call_llm(messages, fallback_model, base_url, api_key,
                                    timeout, max_retries, temperature, max_tokens,
                                    use_completion_tokens)
            raise

    return ""


def parse_json_response(text: str) -> list | dict | None:
    """Parse JSON from LLM response, handling markdown code blocks and preamble."""
    text = text.strip()
    # Strip markdown code block
    if text.startswith("```"):
        lines = text.split("\n")
        end_idx = len(lines) - 1
        while end_idx > 0 and lines[end_idx].strip() != "```":
            end_idx -= 1
        text = "\n".join(lines[1:end_idx] if end_idx > 0 else lines[1:])

    # Find JSON start
    for start_char in ("[", "{"):
        idx = text.find(start_char)
        if idx >= 0:
            candidate = text[idx:]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue

    return None
