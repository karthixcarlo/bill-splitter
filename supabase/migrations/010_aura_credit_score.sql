-- Aura Credit Score System
-- Event-sourced scoring: every action creates an event, score is sum of points

CREATE TABLE IF NOT EXISTS aura_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bill_id UUID REFERENCES bills(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'fast_payment',      -- +50: paid within 1 hour
        'normal_payment',    -- +20: paid within 24 hours
        'slow_payment',      -- -10: paid after 24 hours
        'nudge_received',    -- -30: had to be nudged
        'multi_nudge',       -- -50: nudged 3+ times on same bill
        'dodge_attempt',     -- -100: leave request
        'hosted_bill',       -- +40: created a bill
        'fast_claim',        -- +10: claimed items within 10 min
        'roulette_loser',    -- -20: lost roulette
        'payment_cleared',   -- +15: host verified payment
        'streak_bonus'       -- +25: squad streak milestone
    )),
    points INT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add aura_score column to users table (cached score for fast reads)
ALTER TABLE users ADD COLUMN IF NOT EXISTS aura_score INT DEFAULT 500;

-- Add min_aura_threshold to bills (host can set minimum aura to join)
ALTER TABLE bills ADD COLUMN IF NOT EXISTS min_aura_threshold INT DEFAULT 0;

-- Enable RLS
ALTER TABLE aura_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own events
CREATE POLICY "Users can read own aura events" ON aura_events
    FOR SELECT USING (auth.uid() = user_id);

-- Service role inserts events (backend handles logic)
CREATE POLICY "Service role can insert aura events" ON aura_events
    FOR INSERT WITH CHECK (true);

-- Anyone can read any user's cached aura_score from users table (public profile)
-- (Already covered by existing users SELECT policy)

-- Function to recalculate and cache aura score
CREATE OR REPLACE FUNCTION recalculate_aura_score()
RETURNS TRIGGER AS $$
DECLARE
    new_score INT;
BEGIN
    SELECT GREATEST(0, LEAST(1000, 500 + COALESCE(SUM(points), 0)))
    INTO new_score
    FROM aura_events
    WHERE user_id = NEW.user_id;

    UPDATE users SET aura_score = new_score WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: recalculate score on every new event
CREATE TRIGGER trg_recalculate_aura
    AFTER INSERT ON aura_events
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_aura_score();

-- Indexes
CREATE INDEX idx_aura_events_user ON aura_events(user_id, created_at DESC);
CREATE INDEX idx_users_aura_score ON users(aura_score DESC);
