-- Migration: Open up SELECT access for all authenticated users
-- The existing RLS policies use complex subqueries that silently return empty results.
-- These simple policies guarantee any logged-in user can read bills and participants.

-- Bills: any authenticated user can read any bill
CREATE POLICY "Allow authenticated read bills"
    ON public.bills FOR SELECT
    TO authenticated
    USING (true);

-- Participants: any authenticated user can read any participant row
CREATE POLICY "Allow authenticated read participants"
    ON public.participants FOR SELECT
    TO authenticated
    USING (true);

-- Bill items: any authenticated user can read any bill item
CREATE POLICY "Allow authenticated read bill_items"
    ON public.bill_items FOR SELECT
    TO authenticated
    USING (true);

-- Claims: any authenticated user can read any claim
CREATE POLICY "Allow authenticated read claims"
    ON public.claims FOR SELECT
    TO authenticated
    USING (true);

-- Users: any authenticated user can read any user profile
CREATE POLICY "Allow authenticated read users"
    ON public.users FOR SELECT
    TO authenticated
    USING (true);
