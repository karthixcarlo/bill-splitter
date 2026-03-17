-- Migration: Fix participant RLS policies
-- The existing INSERT policy only allows auth.uid() = user_id,
-- which blocks the host from adding friends via the frontend (anon key).
-- The backend uses service_role (bypasses RLS), but we add this policy
-- so the host can also insert friends directly from the frontend if needed.

-- Allow bill hosts to insert ANY participant into their bills
CREATE POLICY "Host can add participants to their bills"
    ON public.participants FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_id
            AND bills.host_id = auth.uid()
        )
    );

-- Allow any authenticated user to SELECT their own participant rows
-- (needed for dashboard queries via anon key)
CREATE POLICY "Users can view own participations"
    ON public.participants FOR SELECT
    USING (auth.uid() = user_id);

-- Enable Realtime for participants table (needed for dashboard live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
