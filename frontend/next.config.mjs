/** @type {import('next').NextConfig} */

// Extract Supabase hostname from env so image domain isn't hardcoded
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : 'nljyqiooomoebxysznle.supabase.co';

// Backend URL: prefer server-side API_URL (no NEXT_PUBLIC_ prefix, set in Vercel server env vars).
// Falls back to NEXT_PUBLIC_API_URL for backwards compatibility, then localhost for local dev.
const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

const nextConfig = {
    images: {
        domains: [supabaseHost],
    },
    // Proxy all backend API calls through Next.js so mobile browsers never need to
    // reach the Railway backend directly (fixes "Could not load bill" on mobile).
    async rewrites() {
        return [
            { source: '/api/bills/:path*', destination: `${backendUrl}/api/bills/:path*` },
            { source: '/api/parse-bill', destination: `${backendUrl}/api/parse-bill` },
            { source: '/api/scan-qr', destination: `${backendUrl}/api/scan-qr` },
            { source: '/api/aura/:path*', destination: `${backendUrl}/api/aura/:path*` },
        ];
    },
};

export default nextConfig;
