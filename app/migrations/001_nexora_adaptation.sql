-- ============================================================
-- Agent Portal — Database Migration: Nexora Platform Adaptation
-- Run AFTER schema.sql (which creates the base 16 tables)
-- 
-- Changes made during Nexora deployment (2026-04-02):
--   1. AP_bots: add status column (active/disabled)
--   2. AP_portal_settings: new table for frontend settings
-- 
-- Usage:
--   psql -h <host> -U agent_portal -d agent_portal -f migrations/001_nexora_adaptation.sql
--   OR run via: docker exec postgres psql -U agent_portal -d agent_portal -f /path/to/001_nexora_adaptation.sql
-- ============================================================

-- 1. AP_bots: add status column
ALTER TABLE "AP_bots" ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
COMMENT ON COLUMN "AP_bots".status IS 'Bot status: active or disabled';

-- 2. AP_portal_settings: frontend configuration store
CREATE TABLE IF NOT EXISTS "AP_portal_settings" (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE "AP_portal_settings" IS 'Key-value store for portal frontend settings (default bot, etc.)';

-- 3. Set default portal settings (idempotent)
INSERT INTO "AP_portal_settings" (key, value)
VALUES ('default_bot', '{"agent_id": "nexora", "name": "Nexora", "mm_user_id": "", "emoji": "🦞"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
