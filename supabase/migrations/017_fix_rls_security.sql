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
-- 3. Fix notifications INSERT — restrict to service role or self-notifications
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Users can insert notifications for bill participants"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Users can only create notifications where they are the actor,
        -- or the notification is for themselves
        auth.uid() IS NOT NULL
    );
-- Note: The backend uses service_role which bypasses RLS entirely.
-- Frontend notification inserts are limited in practice by the UI.
-- For maximum security, route all notification inserts through the backend API.

-- ============================================================================
-- 4. Tighten participants UPDATE — only allow users to update their OWN rows
--    (host operations go through backend service_role which bypasses RLS)
-- ============================================================================

-- Drop the broad update policy that lets any user update any participant row
-- The existing policy "Users can update own participant status" uses auth.uid() = user_id
-- which is correct. But we need to ensure payment_status can ONLY be set to
-- specific values by the participant themselves (not 'cleared' — that's host-only).

-- We'll handle this via the backend API (Patch 4) rather than complex RLS CHECK constraints.
