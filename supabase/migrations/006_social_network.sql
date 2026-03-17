-- Migration: Social Network — Friendships & Messages
-- Run this in the Supabase SQL Editor

-- Friendships table
CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id_1 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id_2 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id_1, user_id_2)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can see friendships they're part of
CREATE POLICY "Users can view own friendships"
    ON public.friendships FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id_1 OR auth.uid() = user_id_2);

-- Users can send friend requests (insert)
CREATE POLICY "Users can send friend requests"
    ON public.friendships FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id_1);

-- Users can update friendships they received (accept/reject)
CREATE POLICY "Users can update received friendships"
    ON public.friendships FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id_2)
    WITH CHECK (auth.uid() = user_id_2);

-- Users can delete friendships they're part of
CREATE POLICY "Users can delete own friendships"
    ON public.friendships FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id_1 OR auth.uid() = user_id_2);

-- Messages table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can see messages they sent or received
CREATE POLICY "Users can view own messages"
    ON public.messages FOR SELECT
    TO authenticated
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Users can send messages
CREATE POLICY "Users can send messages"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = sender_id);

-- Enable Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
