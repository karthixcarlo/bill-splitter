-- Migration 017: Fix RLS — enable enforcement + replace permissive policies

-- ============================================================================
-- 1. Enable RLS on all tables (policies are useless without this)
-- ============================================================================

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Drop overly permissive USING(true) policies from migration 004
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated read bills" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated read participants" ON public.participants;
DROP POLICY IF EXISTS "Allow authenticated read bill_items" ON public.bill_items;
DROP POLICY IF EXISTS "Allow authenticated read claims" ON public.claims;

-- ============================================================================
-- 3. Drop new policies in case this migration was partially run before
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users read own bills" ON public.bills;
DROP POLICY IF EXISTS "Authenticated users read own bill items" ON public.bill_items;
DROP POLICY IF EXISTS "Authenticated users read own bill participants" ON public.participants;
DROP POLICY IF EXISTS "Authenticated users read own bill claims" ON public.claims;

-- ============================================================================
-- 4. Create properly scoped SELECT policies
-- ============================================================================

-- Bills: only host or participant can read
CREATE POLICY "Authenticated users read own bills"
    ON public.bills FOR SELECT
    TO authenticated
    USING (
        host_id = auth.uid()
        OR id IN (
            SELECT bill_id FROM public.participants WHERE user_id = auth.uid()
        )
    );

-- Bill items: only from bills the user is part of
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

-- Participants: only rows from bills the user is part of
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

-- Claims: only from bills the user is part of
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
