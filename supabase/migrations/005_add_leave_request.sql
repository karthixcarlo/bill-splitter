-- Migration: Anti-Dodge System
-- Add leave_requested column so participants must request to leave (host approves/denies)

ALTER TABLE public.participants
    ADD COLUMN IF NOT EXISTS leave_requested BOOLEAN DEFAULT false;

-- Allow participants to update their own leave_requested to true
CREATE POLICY "Participants can request to leave"
    ON public.participants FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Allow hosts to update leave_requested (deny = set back to false) on their bills
CREATE POLICY "Hosts can manage leave requests"
    ON public.participants FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_id
            AND bills.host_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_id
            AND bills.host_id = auth.uid()
        )
    );

-- Allow hosts to delete participants from their bills (approve leave)
CREATE POLICY "Hosts can remove participants from their bills"
    ON public.participants FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_id
            AND bills.host_id = auth.uid()
        )
    );
