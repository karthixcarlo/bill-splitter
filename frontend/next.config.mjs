/** @type {import('next').NextConfig} */

// Extract Supabase hostname from env so image domain isn't hardcoded
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : 'nljyqiooomoebxysznle.supabase.co';

const nextConfig = {
    images: {
        domains: [supabaseHost],
    },
    // CORS headers removed — backend handles CORS via FastAPI CORSMiddleware.
    // Adding them here caused Access-Control-Allow-Origin to be hardcoded to localhost.
};

export default nextConfig;
