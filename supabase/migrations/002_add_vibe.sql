-- Migration: Add vibe column to users table
-- Run this in the Supabase SQL Editor

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS vibe TEXT;
