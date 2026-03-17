-- Fix: infinite recursion in squad_members RLS policy
-- The SELECT policy on squad_members referenced squad_members itself, causing a loop.
-- Solution: use a SECURITY DEFINER function to bypass RLS when checking membership.

-- Step 1: Create a helper function that bypasses RLS
CREATE OR REPLACE FUNCTION get_user_squad_ids(uid UUID)
RETURNS SETOF UUID AS $$
    SELECT squad_id FROM squad_members WHERE user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Step 2: Drop the broken policies
DROP POLICY IF EXISTS "Members can read their squads" ON squads;
DROP POLICY IF EXISTS "Members can read squad members" ON squad_members;
DROP POLICY IF EXISTS "Squad members can read ledger" ON squad_ledger;

-- Step 3: Recreate policies using the helper function (no recursion)
CREATE POLICY "Members can read their squads" ON squads
    FOR SELECT USING (
        id IN (SELECT get_user_squad_ids(auth.uid()))
    );

CREATE POLICY "Members can read squad members" ON squad_members
    FOR SELECT USING (
        squad_id IN (SELECT get_user_squad_ids(auth.uid()))
    );

CREATE POLICY "Squad members can read ledger" ON squad_ledger
    FOR SELECT USING (
        squad_id IN (SELECT get_user_squad_ids(auth.uid()))
    );
