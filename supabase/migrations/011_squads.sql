-- Squad System: persistent friend groups with ledger + streaks

CREATE TABLE IF NOT EXISTS squads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    emoji TEXT DEFAULT '🍕',
    streak_count INT DEFAULT 0,
    last_bill_week TEXT, -- e.g. '2026-10' for week tracking
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS squad_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    squad_id UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(squad_id, user_id)
);

-- Running balance ledger: net debts within a squad
CREATE TABLE IF NOT EXISTS squad_ledger (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    squad_id UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL,
    bill_id UUID REFERENCES bills(id) ON DELETE SET NULL,
    description TEXT,
    settled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_ledger ENABLE ROW LEVEL SECURITY;

-- Squad: members can read their own squads
CREATE POLICY "Members can read their squads" ON squads
    FOR SELECT USING (
        id IN (SELECT squad_id FROM squad_members WHERE user_id = auth.uid())
    );

-- Anyone authenticated can create squads
CREATE POLICY "Authenticated users can create squads" ON squads
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Admin can update squad
CREATE POLICY "Admin can update squad" ON squads
    FOR UPDATE USING (
        id IN (SELECT squad_id FROM squad_members WHERE user_id = auth.uid() AND role = 'admin')
    );

-- Squad members: can read members of squads they belong to
CREATE POLICY "Members can read squad members" ON squad_members
    FOR SELECT USING (
        squad_id IN (SELECT squad_id FROM squad_members AS sm WHERE sm.user_id = auth.uid())
    );

-- Any authenticated user can insert (join/invite)
CREATE POLICY "Authenticated can join squads" ON squad_members
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Members can leave (delete themselves)
CREATE POLICY "Members can leave" ON squad_members
    FOR DELETE USING (user_id = auth.uid());

-- Ledger: members of the squad can read
CREATE POLICY "Squad members can read ledger" ON squad_ledger
    FOR SELECT USING (
        squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = auth.uid())
    );

-- Authenticated can insert ledger entries
CREATE POLICY "Authenticated can insert ledger" ON squad_ledger
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Ledger entries can be updated (settled)
CREATE POLICY "Participants can settle ledger" ON squad_ledger
    FOR UPDATE USING (
        from_user_id = auth.uid() OR to_user_id = auth.uid()
    );

-- Indexes
CREATE INDEX idx_squad_members_user ON squad_members(user_id);
CREATE INDEX idx_squad_members_squad ON squad_members(squad_id);
CREATE INDEX idx_squad_ledger_squad ON squad_ledger(squad_id, settled);
CREATE INDEX idx_squad_ledger_users ON squad_ledger(from_user_id, to_user_id);
