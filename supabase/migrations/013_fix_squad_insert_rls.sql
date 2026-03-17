-- Fix: INSERT on squads fails because the SELECT policy blocks returning the new row.
-- After INSERT, Supabase tries to SELECT the row back (.select().single()),
-- but the SELECT policy checks squad_members — which has no entry yet (we add it AFTER creating the squad).
-- Fix: allow creators to read their own squads too.

-- Drop and recreate the squads SELECT policy to also allow the creator
DROP POLICY IF EXISTS "Members can read their squads" ON squads;
CREATE POLICY "Members or creator can read squads" ON squads
    FOR SELECT USING (
        created_by = auth.uid()
        OR id IN (SELECT get_user_squad_ids(auth.uid()))
    );

-- Also ensure the INSERT policy is correct
DROP POLICY IF EXISTS "Authenticated users can create squads" ON squads;
CREATE POLICY "Authenticated users can create squads" ON squads
    FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Ensure squad_members INSERT allows adding yourself
DROP POLICY IF EXISTS "Authenticated can join squads" ON squad_members;
CREATE POLICY "Authenticated can join squads" ON squad_members
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
