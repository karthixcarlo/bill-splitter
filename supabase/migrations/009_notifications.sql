-- Notifications table for nudges, payment confirmations, etc.
CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('nudge', 'payment_cleared', 'payment_rejected', 'roulette_loser')),
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
CREATE POLICY "Users can read own notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id);

-- Users can update (mark read) their own notifications
CREATE POLICY "Users can update own notifications" ON notifications
    FOR UPDATE USING (auth.uid() = user_id);

-- Any authenticated user can insert notifications (for nudges)
CREATE POLICY "Authenticated users can insert notifications" ON notifications
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Index for fast lookups
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read, created_at DESC);
