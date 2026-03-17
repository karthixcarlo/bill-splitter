-- 016: "Beg for Mercy" (micro-debt forgiveness) + "The Snitch" (escalated nudges)

-- Mercy columns on participants
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS mercy_type TEXT NOT NULL DEFAULT 'none'
    CHECK (mercy_type IN ('none', 'text', 'audio')),
  ADD COLUMN IF NOT EXISTS mercy_payload TEXT;

-- payment_status already accepts arbitrary text; add 'pending_mercy' as a recognized state
-- (no CHECK constraint exists on payment_status — it's free-text, so no DDL needed)

-- Snitch columns on users (emergency contact for debt escalation)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS snitch_name TEXT,
  ADD COLUMN IF NOT EXISTS snitch_phone TEXT;
