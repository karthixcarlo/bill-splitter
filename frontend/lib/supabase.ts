import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Centralized backend API URL.
// In production, Next.js rewrites in next.config.mjs proxy /api/* to the backend,
// so this can be '' (relative URL). Set NEXT_PUBLIC_API_URL only if bypassing the proxy.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Helper to get the current session's access token for backend API calls
export async function getAccessToken(): Promise<string | null> {
    try {
        // getSession reads from storage; may be stale. Try it first for speed.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) return session.access_token;
        // Fallback: getUser() forces a server round-trip and refreshes the session
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: refreshed } = await supabase.auth.getSession();
            return refreshed?.session?.access_token ?? null;
        }
        return null;
    } catch {
        return null;
    }
}

// Helper to build Authorization headers for backend fetch calls
export async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    if (!token) {
        console.error('Missing Auth Token! User may not be logged in. Backend will reject this request.');
        return {};
    }
    return { 'Authorization': `Bearer ${token}` };
}

// Helper to get current user — returns null safely if Supabase is unreachable
export async function getCurrentUser() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return user;
    } catch (e) {
        // Supabase project may be paused or offline — return null gracefully
        return null;
    }
}

// Helper to get user profile
export async function getUserProfile(userId: string) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) throw error;
    return data;
}

// Helper to update user profile
export async function updateUserProfile(userId: string, updates: any) {
    const { data, error } = await supabase
        .from('users')
        .upsert({ id: userId, ...updates })
        .select()
        .single();

    if (error) throw error;
    return data;
}
