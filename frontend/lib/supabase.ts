import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
