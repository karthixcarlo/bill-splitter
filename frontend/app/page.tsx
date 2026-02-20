'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { ArrowRight, Sparkles, Phone, AlertCircle } from 'lucide-react';

export default function LandingPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [billCode, setBillCode] = useState('');
    const [user, setUser] = useState<any>(null);
    const [authError, setAuthError] = useState('');

    // Check if user is already logged in
    useEffect(() => {
        async function checkUser() {
            try {
                const currentUser = await getCurrentUser();
                if (currentUser) {
                    setUser(currentUser);
                }
            } catch (e) {
                // silently ignore – just means not logged in
            }
        }
        checkUser();
    }, []);

    async function handleGoogleLogin() {
        setLoading(true);
        setAuthError('');
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/host`,
                },
            });
            if (error) {
                setAuthError('Google login failed: ' + error.message);
                setLoading(false);
            }
            // If successful, browser redirects – no need to setLoading(false)
        } catch (e: any) {
            setAuthError('Google login failed: ' + (e?.message || 'Unknown error'));
            setLoading(false);
        }
    }

    async function handlePhoneLogin() {
        setAuthError('Phone Auth requires Supabase SMS configuration in the dashboard.');
    }

    // Dev bypass – no auth call, just navigate directly
    function handleDevBypass() {
        router.push('/host');
    }

    function handleJoinBill() {
        if (!billCode.trim()) return;
        router.push(`/bill/${billCode.trim()}`);
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center p-6 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none" />

            <main className="relative z-10 w-full max-w-md space-y-12">

                {/* Hero Section */}
                <div className="text-center space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-emerald-500 mb-2 animate-fade-in">
                        <Sparkles className="w-3 h-3" />
                        <span>AI-Powered Splitting</span>
                    </div>
                    <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white mb-2">
                        Bro Please <span className="text-emerald-500">Pay.</span>
                    </h1>
                    <p className="text-zinc-400 text-lg leading-relaxed max-w-sm mx-auto">
                        Split bills without the awkward silence. <br />
                        AI-powered, friend-approved.
                    </p>
                </div>

                {/* Auth Error Banner */}
                {authError && (
                    <div className="flex items-start gap-3 p-4 bg-red-950/50 border border-red-800/60 rounded-xl text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{authError}</span>
                    </div>
                )}

                {/* Auth Component (Host) */}
                {!user ? (
                    <div className="space-y-4">
                        <div className="space-y-3">
                            <button
                                onClick={handleGoogleLogin}
                                disabled={loading}
                                className="w-full group relative flex items-center justify-center gap-3 px-6 py-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.1)] transition-all duration-300 disabled:opacity-60"
                            >
                                <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                                    <span className="text-black font-bold text-xs">G</span>
                                </div>
                                <span className="font-semibold text-zinc-100">
                                    {loading ? 'Redirecting...' : 'Continue with Google'}
                                </span>
                            </button>

                            <button
                                onClick={handlePhoneLogin}
                                className="w-full group relative flex items-center justify-center gap-3 px-6 py-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.1)] transition-all duration-300"
                            >
                                <Phone className="w-5 h-5 text-zinc-400 group-hover:text-emerald-500 transition-colors" />
                                <span className="font-semibold text-zinc-100">Continue with Phone</span>
                            </button>

                            {/* Dev Bypass – no network call */}
                            <button
                                onClick={handleDevBypass}
                                className="w-full text-xs text-zinc-600 hover:text-emerald-500 transition-colors pt-2"
                            >
                                (Dev: Skip Login / Go to Host)
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="text-center space-y-4">
                        <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                            <p className="text-zinc-400 text-sm mb-1">Welcome back,</p>
                            <p className="text-white font-semibold truncate">{user.email || 'Friend'}</p>
                        </div>
                        <button
                            onClick={() => router.push('/host')}
                            className="w-full py-4 gradient-emerald rounded-xl font-bold text-black shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-transform"
                        >
                            Start Hosting
                        </button>
                    </div>
                )}

                {/* Guest Access */}
                <div className="space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="h-px bg-zinc-800 flex-1" />
                        <span className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Joining a bill?</span>
                        <div className="h-px bg-zinc-800 flex-1" />
                    </div>

                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-emerald-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
                        <div className="relative flex gap-2">
                            <input
                                type="text"
                                placeholder="Enter Bill Code"
                                value={billCode}
                                onChange={(e) => setBillCode(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleJoinBill()}
                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all font-mono tracking-wider"
                            />
                            <button
                                onClick={handleJoinBill}
                                disabled={!billCode}
                                className="aspect-square bg-zinc-800 hover:bg-emerald-500 hover:text-zinc-950 border border-zinc-700 hover:border-emerald-500 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-500"
                            >
                                <ArrowRight className="w-6 h-6" />
                            </button>
                        </div>
                    </div>
                </div>

            </main>

            {/* Footer */}
            <footer className="absolute bottom-6 text-center w-full">
                <p className="text-[10px] text-zinc-700 uppercase tracking-[0.2em] font-medium">Bro please pay • 2026</p>
            </footer>
        </div>
    );
}
