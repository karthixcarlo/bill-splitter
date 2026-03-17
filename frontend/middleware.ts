import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
    const res = NextResponse.next();

    // Refresh the Supabase auth session on every request so cookies stay in sync.
    // This ensures server-side rendering and API route handlers can access the session.
    // Route protection is handled client-side in each page's useEffect for now,
    // because Supabase JS client sets tokens in memory first and cookies lag behind.
    const supabase = createMiddlewareClient({ req, res });
    await supabase.auth.getSession();

    return res;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|icon-).*)',
    ],
};
