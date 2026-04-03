"""
Agent Portal Digest — Configuration

All secrets must be set via environment variables. No hardcoded defaults for secrets.
To load from a .env file, either `source .env` before running,
or use python-dotenv in your wrapper script.
"""

import os
import sys
from pathlib import Path


def _require_env(name: str) -> str:
    """Read a required environment variable, exit if missing."""
    value = os.environ.get(name, "")
    if not value:
        print(f"❌ {name} is required but not set. Exiting.", file=sys.stderr)
        sys.exit(1)
    return value


# === Mattermost (required) ===
MM_BASE_URL = _require_env("MM_BASE_URL")
MM_API = f"{MM_BASE_URL}/api/v4"
MM_ADMIN_TOKEN = _require_env("MM_ADMIN_TOKEN")
DADDY_USER_ID = os.environ.get("DADDY_USER_ID", "8zzs18ha4fdhf8jt8ybm61eqdw")
TEAM_ID = os.environ.get("MM_TEAM_ID", "x1dtaayrof878chorb6mrj9ana")

# === Database (PostgreSQL direct connection, required) ===
DATABASE_URL = _require_env("DATABASE_URL")

# === LLM — L1: Structured extraction (gpt-4.1) ===
L1_PROVIDER = "azure-foundry"
L1_BASE_URL = _require_env("L1_BASE_URL")
L1_API_KEY = _require_env("L1_API_KEY")
L1_MODEL = os.environ.get("L1_MODEL", "gpt-4.1")
L1_FALLBACK = os.environ.get("L1_FALLBACK", "gpt-4o")

# === LLM — L2/L3: Reports & project insights (gpt-5.4) ===
L2_PROVIDER = "azure-foundry"
L2_BASE_URL = os.environ.get("L2_BASE_URL", L1_BASE_URL)
L2_API_KEY = os.environ.get("L2_API_KEY", L1_API_KEY)
L2_MODEL = os.environ.get("L2_MODEL", "gpt-5.4")

L3_MODEL = os.environ.get("L3_MODEL", "gpt-5.4")

# === Data directory (raw backups, caches, cursors) ===
PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = os.environ.get(
    "DIGEST_DATA_DIR",
    str(PROJECT_ROOT / "data"),
)

# === Filter rules (L0: messages matching any pattern are dropped) ===
FILTER_PATTERNS = [
    "HEARTBEAT_OK",
    "NO_REPLY",
    "heartbeat",
    "[System Event]",
]

# === Known bot emoji map (for display; runtime list comes from MM API) ===
BOT_EMOJI = {
    "ottor-pc-cloud-bot": "🐰",
    "quokka": "🐨",
    "giraffe": "🦒",
    "kids": "👶",
    "health": "💊",
    "media-agent": "📷",
    "bnef": "📊",
    "bibot": "📈",
    "misse": "🐱",
}
