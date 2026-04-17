-- Migration 018: Harden bill access, payment-state writes, and abuse-prone inserts

-- Keep participant payment states aligned with the mercy flow.
ALTER TABLE public.participants
    DROP CONSTRAINT IF EXISTS chk_payment_status;
ALTER TABLE public.participants
    ADD CONSTRAINT chk_payment_status
    CHECK (payment_status IN ('unpaid', 'pending_audit', 'pending_mercy', 'cleared'));

-- Bill participation should be created by the host, not self-service by arbitrary users.
DROP POLICY IF EXISTS "Users can join bills as participants" ON public.participants;
DROP POLICY IF EXISTS "Host can add participants to their bills" ON public.participants;
CREATE POLICY "Host can add participants to their bills"
    ON public.participants FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.bills
            WHERE bills.id = participants.bill_id
              AND bills.host_id = auth.uid()
        )
    );

-- Claims must come from invited participants on that bill.
DROP POLICY IF EXISTS "Users can create own claims" ON public.claims;
CREATE POLICY "Invited participants can create own claims"
    ON public.claims FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
            FROM public.bill_items bi
            JOIN public.participants p ON p.bill_id = bi.bill_id
            JOIN public.bills b ON b.id = bi.bill_id
            JOIN public.users u ON u.id = auth.uid()
            WHERE bi.id = claims.item_id
              AND p.user_id = auth.uid()
              AND (
                  COALESCE(b.min_aura_threshold, 0) <= 0
                  OR COALESCE(u.aura_score, 500) >= COALESCE(b.min_aura_threshold, 0)
              )
        )
    );

-- Payments must be sent by a participant to that bill's host.
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;
CREATE POLICY "Participants can insert own bill payments"
    ON public.payments FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = payer_id
        AND EXISTS (
            SELECT 1
            FROM public.participants p
            JOIN public.bills b ON b.id = p.bill_id
            WHERE p.bill_id = payments.bill_id
              AND p.user_id = auth.uid()
              AND b.host_id = payments.receiver_id
        )
    );

-- Notifications should only be created by the bill host for users on that bill.
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
CREATE POLICY "Hosts can insert bill notifications"
    ON public.notifications FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = from_user_id
        AND bill_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.bills b
            JOIN public.participants p ON p.bill_id = b.id
            WHERE b.id = notifications.bill_id
              AND b.host_id = auth.uid()
              AND p.user_id = notifications.user_id
        )
    );

-- Aura events must be backend-controlled; authenticated clients should not insert directly.
DROP POLICY IF EXISTS "Service role can insert aura events" ON public.aura_events;
CREATE POLICY "Service role can insert aura events"
    ON public.aura_events FOR INSERT
    TO service_role
    WITH CHECK (true);
