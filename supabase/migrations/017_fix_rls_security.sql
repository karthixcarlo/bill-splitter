-- Migration 017: Security fix — drop overly permissive SELECT policies from migration 004
-- Migration 004 added USING(true) to bills, bill_items, participants, claims, users
-- which lets ANY authenticated user read ALL rows. This is a data leak.
--
-- The backend uses service_role key (bypasses RLS), so these only affect frontend (anon key).
-- Frontend needs: users (public profiles), claims (for bill participants), participants (own rows).

-- ============================================================================
-- 1. Drop the nuke policies from migration 004
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated read bills" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated read participants" ON public.participants;
DROP POLICY IF EXISTS "Allow authenticated read bill_items" ON public.bill_items;
DROP POLICY IF EXISTS "Allow authenticated read claims" ON public.claims;
-- Keep users readable — usernames/aura are public profile data (already had USING(true) in schema.sql)
-- DROP POLICY IF EXISTS "Allow authenticated read users" ON public.users;

-- ============================================================================
-- 2. Add properly scoped SELECT policies
-- ============================================================================

-- Bills: user can read bills they host OR participate in
CREATE POLICY "Authenticated users read own bills"
    ON public.bills FOR SELECT
    TO authenticated
    USING (
        host_id = auth.uid()
        OR id IN (
            SELECT bill_id FROM public.participants WHERE user_id = auth.uid()
        )
    );

-- Bill items: user can read items from bills they're in
CREATE POLICY "Authenticated users read own bill items"
    ON public.bill_items FOR SELECT
    TO authenticated
    USING (
        bill_id IN (
            SELECT id FROM public.bills WHERE host_id = auth.uid()
            UNION
            SELECT bill_id FROM public.participants WHERE user_id = auth.uid()
        )
    );

-- Participants: user can read participant rows from their own bills
CREATE POLICY "Authenticated users read own bill participants"
    ON public.participants FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR bill_id IN (
            SELECT id FROM public.bills WHERE host_id = auth.uid()
        )
        OR bill_id IN (
            SELECT bill_id FROM public.participants AS p2 WHERE p2.user_id = auth.uid()
        )
    );

-- Claims: user can read claims from bills they participate in
CREATE POLICY "Authenticated users read own bill claims"
    ON public.claims FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR item_id IN (
            SELECT bi.id FROM public.bill_items bi
            JOIN public.participants p ON p.bill_id = bi.bill_id
            WHERE p.user_id = auth.uid()
        )
        OR item_id IN (
            SELECT bi.id FROM public.bill_items bi
            JOIN public.bills b ON b.id = bi.bill_id
            WHERE b.host_id = auth.uid()
        )
    );

-- ============================================================================
-- 3. Fix notifications INSERT (only if table exists)
-- ============================================================================

-- Note: If notifications table exists (migration 009), run this separately:
-- DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
-- Then re-create with a tighter policy if needed.

-- ============================================================================
-- 4. Participants UPDATE is already scoped to auth.uid() = user_id.
--    Host audit/mercy operations now go through backend API (service_role,
--    bypasses RLS) so no RLS change needed here.
-- ============================================================================
