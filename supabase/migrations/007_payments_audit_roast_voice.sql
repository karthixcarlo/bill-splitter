-- Migration 007: Payments, Payment Audit, AI Roast, Voice Notes
-- Run this in the Supabase SQL Editor

-- 1. Payments table (Low Taper Fade — partial payments)
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    payer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payments"
    ON public.payments FOR SELECT TO authenticated
    USING (auth.uid() = payer_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can insert own payments"
    ON public.payments FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = payer_id);

-- 2. Payment audit status on participants (Trust Me Bro)
ALTER TABLE public.participants
    ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';

-- 3. AI roast column on bills (Brain Rot Roaster)
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS ai_roast TEXT;

-- 4. Audio URL column on messages (Skibidi Voice Notes)
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- 5. Voice notes storage bucket
-- NOTE: Run this separately in Supabase Dashboard > Storage > New Bucket
-- Bucket name: voice_notes, Public: true
-- Or use the SQL below:
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice_notes', 'voice_notes', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload voice notes
CREATE POLICY "Authenticated users can upload voice notes"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'voice_notes');

CREATE POLICY "Anyone can read voice notes"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'voice_notes');

-- Enable Realtime for payments
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
