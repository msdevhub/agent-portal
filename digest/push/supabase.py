"""
Supabase REST client + agent ID mapping.

Extracted from the original pusher.py for reuse across modules.
"""

import json
import urllib.request

from config import SUPABASE_REST, SUPABASE_SERVICE_KEY

# MM username → Portal agent_id mapping
# Portal agent cards use their own ID scheme; all DB writes must use portal IDs.
MM_TO_PORTAL = {
    "ottor-pc-cloud-bot": "rabbit",
    "researcher": "research",
    "craftbot": "research-craft",
    "portalbot": "research-portal",
    "bibot": "research-bi",
    "gatewaybot": "clawline-gateway",
    "channelbot": "clawline-channel",
    "webbot": "clawline-client-web",
}


def resolve_agent_id(mm_username: str) -> str:
    """Convert MM username to portal agent_id. Unmapped names pass through."""
    return MM_TO_PORTAL.get(mm_username, mm_username)


def supabase_request(
    path: str,
    data: dict | list | None,
    method: str = "POST",
    headers_extra: dict | None = None,
) -> dict | list | None:
    """Generic Supabase REST API call with error handling."""
    url = f"{SUPABASE_REST}/{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if headers_extra:
        headers.update(headers_extra)

    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers=headers,
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"  ⚠️ Supabase {method} {path} 失败 ({e.code}): {error_body[:200]}")
        return None
