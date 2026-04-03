"""
Agent ID mapping — MM username → Portal agent_id.
"""

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
