-- Tighten overly permissive INSERT policies on squad_members, squad_ledger, notifications

-- ========== SQUAD_MEMBERS: Only admins can add others, users can add themselves ==========
DROP POLICY IF EXISTS "squad_members_insert" ON squad_members;
CREATE POLICY "squad_members_insert" ON squad_members
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND (
            -- User adding themselves
            user_id = auth.uid()
            -- OR an admin of the squad is adding someone
            OR EXISTS (
                SELECT 1 FROM squad_members sm
                WHERE sm.squad_id = squad_id
                AND sm.user_id = auth.uid()
                AND sm.role = 'admin'
            )
            -- OR the squad creator (handles first insert before admin row exists)
            OR EXISTS (
                SELECT 1 FROM squads s
                WHERE s.id = squad_id
                AND s.created_by = auth.uid()
            )
        )
    );

-- ========== SQUAD_LEDGER: Only squad members can insert, must be party to the transaction ==========
DROP POLICY IF EXISTS "ledger_insert" ON squad_ledger;
CREATE POLICY "ledger_insert" ON squad_ledger
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND (auth.uid() = from_user_id OR auth.uid() = to_user_id)
        AND squad_id IN (SELECT public.get_user_squad_ids(auth.uid()))
    );

-- NOTE: Notifications table policy skipped — run migration 009 first if notifications table is needed.
