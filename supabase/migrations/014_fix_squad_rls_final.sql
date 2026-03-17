-- NUCLEAR FIX: Drop everything squad-related and rebuild clean.
-- IMPORTANT: Drop policies FIRST (they depend on the function), then drop the function.

-- ========== STEP 1: DROP ALL POLICIES FIRST ==========

-- squads
DROP POLICY IF EXISTS "Members can read their squads" ON squads;
DROP POLICY IF EXISTS "Members or creator can read squads" ON squads;
DROP POLICY IF EXISTS "squads_select" ON squads;
DROP POLICY IF EXISTS "Authenticated users can create squads" ON squads;
DROP POLICY IF EXISTS "squads_insert" ON squads;
DROP POLICY IF EXISTS "Admin can update squad" ON squads;
DROP POLICY IF EXISTS "squads_update" ON squads;

-- squad_members
DROP POLICY IF EXISTS "Members can read squad members" ON squad_members;
DROP POLICY IF EXISTS "squad_members_select" ON squad_members;
DROP POLICY IF EXISTS "Authenticated can join squads" ON squad_members;
DROP POLICY IF EXISTS "squad_members_insert" ON squad_members;
DROP POLICY IF EXISTS "Members can leave" ON squad_members;
DROP POLICY IF EXISTS "squad_members_delete" ON squad_members;

-- squad_ledger
DROP POLICY IF EXISTS "Squad members can read ledger" ON squad_ledger;
DROP POLICY IF EXISTS "ledger_select" ON squad_ledger;
DROP POLICY IF EXISTS "Authenticated can insert ledger" ON squad_ledger;
DROP POLICY IF EXISTS "ledger_insert" ON squad_ledger;
DROP POLICY IF EXISTS "Participants can settle ledger" ON squad_ledger;
DROP POLICY IF EXISTS "ledger_update" ON squad_ledger;

-- ========== STEP 2: NOW SAFE TO DROP THE FUNCTION ==========
DROP FUNCTION IF EXISTS get_user_squad_ids(UUID);

-- ========== STEP 3: RECREATE FUNCTION ==========
CREATE OR REPLACE FUNCTION public.get_user_squad_ids(uid UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT squad_id FROM public.squad_members WHERE user_id = uid;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_squad_ids(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_squad_ids(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_squad_ids(UUID) TO service_role;

-- ========== STEP 4: RECREATE ALL POLICIES ==========

-- squads
CREATE POLICY "squads_select" ON squads
    FOR SELECT USING (
        created_by = auth.uid()
        OR id IN (SELECT public.get_user_squad_ids(auth.uid()))
    );

CREATE POLICY "squads_insert" ON squads
    FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "squads_update" ON squads
    FOR UPDATE USING (created_by = auth.uid());

-- squad_members
CREATE POLICY "squad_members_select" ON squad_members
    FOR SELECT USING (
        squad_id IN (SELECT public.get_user_squad_ids(auth.uid()))
    );

CREATE POLICY "squad_members_insert" ON squad_members
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "squad_members_delete" ON squad_members
    FOR DELETE USING (user_id = auth.uid());

-- squad_ledger
CREATE POLICY "ledger_select" ON squad_ledger
    FOR SELECT USING (
        squad_id IN (SELECT public.get_user_squad_ids(auth.uid()))
    );

CREATE POLICY "ledger_insert" ON squad_ledger
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "ledger_update" ON squad_ledger
    FOR UPDATE USING (
        from_user_id = auth.uid() OR to_user_id = auth.uid()
    );
