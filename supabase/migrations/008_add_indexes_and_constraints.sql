-- Migration 008: Add missing indexes for messages, friendships, payments tables
-- Run AFTER migrations 006 and 007

-- Messages: optimize chat queries
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver
    ON public.messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_created
    ON public.messages(receiver_id, created_at DESC);

-- Friendships: optimize friend roster and request queries
CREATE INDEX IF NOT EXISTS idx_friendships_user1_status
    ON public.friendships(user_id_1, status);
CREATE INDEX IF NOT EXISTS idx_friendships_user2_status
    ON public.friendships(user_id_2, status);

-- Payments: optimize payment lookups per bill and per user
CREATE INDEX IF NOT EXISTS idx_payments_bill_id
    ON public.payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id
    ON public.payments(payer_id);

-- Participants: optimize host payment audit queries
CREATE INDEX IF NOT EXISTS idx_participants_bill_payment_status
    ON public.participants(bill_id, payment_status);

-- Bills: optimize recent bills dashboard
CREATE INDEX IF NOT EXISTS idx_bills_created_at
    ON public.bills(created_at DESC);

-- Add CHECK constraint on payment_status to enforce valid values
ALTER TABLE public.participants
    DROP CONSTRAINT IF EXISTS chk_payment_status;
ALTER TABLE public.participants
    ADD CONSTRAINT chk_payment_status
    CHECK (payment_status IN ('unpaid', 'pending_audit', 'cleared'));
