-- ============================================
-- Namma Atti Bill Splitter - Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Users table (extends auth.users)
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    phone TEXT,
    upi_vpa TEXT, -- e.g., "user@okaxis"
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bills table
CREATE TABLE public.bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    restaurant_name TEXT,
    tax_amount NUMERIC(10, 2) DEFAULT 0,
    service_charge NUMERIC(10, 2) DEFAULT 0,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'locked', 'settled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bill Items table
CREATE TABLE public.bill_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    price_per_unit NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL -- qty * price_per_unit
);

-- Participants table (junction table for users in a bill)
CREATE TABLE public.participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'viewing' CHECK (status IN ('viewing', 'confirmed', 'paid')),
    amount_owed NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(bill_id, user_id)
);

-- Claims table (who ate what)
CREATE TABLE public.claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES public.bill_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    share_fraction NUMERIC(3, 2) DEFAULT 1.0, -- If 2 users claim, both get 0.5
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(item_id, user_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_bills_host_id ON public.bills(host_id);
CREATE INDEX idx_bill_items_bill_id ON public.bill_items(bill_id);
CREATE INDEX idx_participants_bill_id ON public.participants(bill_id);
CREATE INDEX idx_participants_user_id ON public.participants(user_id);
CREATE INDEX idx_claims_item_id ON public.claims(item_id);
CREATE INDEX idx_claims_user_id ON public.claims(user_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- Users: Can read all users, update only their own profile
CREATE POLICY "Users can view all profiles"
    ON public.users FOR SELECT
    USING (true);

CREATE POLICY "Users can update own profile"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.users FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Bills: Host can create, participants can view
CREATE POLICY "Users can create bills"
    ON public.bills FOR INSERT
    WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Users can view bills they participate in"
    ON public.bills FOR SELECT
    USING (
        auth.uid() = host_id OR
        EXISTS (
            SELECT 1 FROM public.participants
            WHERE participants.bill_id = bills.id
            AND participants.user_id = auth.uid()
        )
    );

CREATE POLICY "Host can update their bills"
    ON public.bills FOR UPDATE
    USING (auth.uid() = host_id);

-- Bill Items: Can view if you're part of the bill
CREATE POLICY "Users can view items from their bills"
    ON public.bill_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_items.bill_id
            AND (
                auth.uid() = bills.host_id OR
                EXISTS (
                    SELECT 1 FROM public.participants
                    WHERE participants.bill_id = bills.id
                    AND participants.user_id = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Host can insert items to their bills"
    ON public.bill_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_items.bill_id
            AND auth.uid() = bills.host_id
        )
    );

-- Participants: Auto-join when viewing a bill
CREATE POLICY "Users can view participants in their bills"
    ON public.participants FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = participants.bill_id
            AND (
                auth.uid() = bills.host_id OR
                EXISTS (
                    SELECT 1 FROM public.participants p2
                    WHERE p2.bill_id = bills.id
                    AND p2.user_id = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can join bills as participants"
    ON public.participants FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own participant status"
    ON public.participants FOR UPDATE
    USING (auth.uid() = user_id);

-- Claims: Users can manage their own claims
CREATE POLICY "Users can view claims in their bills"
    ON public.claims FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.bill_items
            JOIN public.bills ON bills.id = bill_items.bill_id
            WHERE bill_items.id = claims.item_id
            AND (
                auth.uid() = bills.host_id OR
                EXISTS (
                    SELECT 1 FROM public.participants
                    WHERE participants.bill_id = bills.id
                    AND participants.user_id = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can create own claims"
    ON public.claims FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own claims"
    ON public.claims FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- STORAGE BUCKET
-- ============================================

-- Create storage bucket for bill images
INSERT INTO storage.buckets (id, name, public)
VALUES ('bill-images', 'bill-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload bill images"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'bill-images' AND
        auth.role() = 'authenticated'
    );

CREATE POLICY "Anyone can view bill images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'bill-images');

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update share_fraction when claims change
CREATE OR REPLACE FUNCTION update_claim_shares()
RETURNS TRIGGER AS $$
BEGIN
    -- Update all claims for the item to split equally
    UPDATE public.claims
    SET share_fraction = 1.0 / (
        SELECT COUNT(*) FROM public.claims
        WHERE item_id = NEW.item_id
    )
    WHERE item_id = NEW.item_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update share fractions
CREATE TRIGGER update_shares_on_claim
AFTER INSERT OR DELETE ON public.claims
FOR EACH ROW
EXECUTE FUNCTION update_claim_shares();

-- Function to auto-add user as participant when they claim an item
CREATE OR REPLACE FUNCTION auto_add_participant()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.participants (bill_id, user_id)
    SELECT bill_items.bill_id, NEW.user_id
    FROM public.bill_items
    WHERE bill_items.id = NEW.item_id
    ON CONFLICT (bill_id, user_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER add_participant_on_claim
BEFORE INSERT ON public.claims
FOR EACH ROW
EXECUTE FUNCTION auto_add_participant();
