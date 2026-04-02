"""
Agent Portal Digest — Configuration

All secrets read from environment variables.
Defaults match the current deployment so it works out of the box.

To load from a .env file, either `source .env` before running,
or use python-dotenv in your wrapper script.
"""

import os
from pathlib import Path

# === Mattermost ===
MM_BASE_URL = os.environ.get("MM_BASE_URL", "https://mm.dora.restry.cn")
MM_API = f"{MM_BASE_URL}/api/v4"
MM_ADMIN_TOKEN = os.environ.get("MM_ADMIN_TOKEN", "")
DADDY_USER_ID = os.environ.get("DADDY_USER_ID", "8zzs18ha4fdhf8jt8ybm61eqdw")
TEAM_ID = os.environ.get("MM_TEAM_ID", "x1dtaayrof878chorb6mrj9ana")

# === Database ===
# Preferred: direct PG connection (set DATABASE_URL)
# Fallback: Supabase REST (set SUPABASE_URL + SUPABASE_SERVICE_KEY)
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# === Supabase (fallback when DATABASE_URL is not set) ===
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://db.dora.restry.cn/pg")
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# === LLM — L1: Structured extraction (gpt-4.1) ===
L1_PROVIDER = "azure-foundry"
L1_BASE_URL = os.environ.get(
    "L1_BASE_URL",
    "https://resley-east-us-2-resource.cognitiveservices.azure.com/openai/v1/",
)
L1_API_KEY = os.environ.get("L1_API_KEY", "")
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
