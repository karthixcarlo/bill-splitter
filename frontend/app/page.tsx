'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, getUserProfile } from '@/lib/supabase';
import { ArrowRight, Sparkles, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LandingPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-zinc-950"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>}>
            <LandingContent />
        </Suspense>
    );
}

function LandingContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const returnTo = searchParams.get('returnTo') || '';
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [billCode, setBillCode] = useState('');
    const [authError, setAuthError] = useState('');

    // Redirect if already logged in
    useEffect(() => {
        async function checkUser() {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;
                const profile = await getUserProfile(session.user.id).catch(() => null);
                if (profile?.upi_vpa) {
                    router.push(returnTo || '/home');
                } else {
                    router.push(returnTo ? `/onboard?returnTo=${encodeURIComponent(returnTo)}` : '/onboard');
                }
            } catch {
                // not logged in — stay on page
            }
        }
        checkUser();
    }, []);

    async function handleAuth() {
        if (!email || !password) { setAuthError('Please enter email and password.'); return; }
        setLoading(true);
        setAuthError('');
        try {
            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) { setAuthError(error.message); return; }
                // signUp may return a session immediately (if email confirm is off)
                if (data.session) {
                    await redirectAfterAuth(data.session.user.id);
                } else {
                    setAuthError('Check your email for a confirmation link.');
                }
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) { setAuthError(error.message); return; }
                await redirectAfterAuth(data.user.id);
            }
        } catch (e: any) {
            setAuthError(e?.message || 'Something went wrong.');
        } finally {
            setLoading(false);
        }
    }

    async function redirectAfterAuth(userId: string) {
        const profile = await getUserProfile(userId).catch(() => null);
        if (profile?.upi_vpa) {
            router.push(returnTo || '/home');
        } else {
            router.push(returnTo ? `/onboard?returnTo=${encodeURIComponent(returnTo)}` : '/onboard');
        }
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

            <main className="relative z-10 w-full max-w-md space-y-10">

                {/* Hero */}
                <div className="text-center space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-emerald-500 mb-2">
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

                {/* Auth Form */}
                <div className="space-y-4">
                    {/* Mode Toggle */}
                    <div className="flex gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
                        <button
                            onClick={() => { setMode('login'); setAuthError(''); }}
                            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                                mode === 'login' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            Log In
                        </button>
                        <button
                            onClick={() => { setMode('signup'); setAuthError(''); }}
                            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                                mode === 'signup' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    {/* Error */}
                    {authError && (
                        <div className="flex items-start gap-3 p-4 bg-red-950/50 border border-red-800/60 rounded-xl text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{authError}</span>
                        </div>
                    )}

                    {/* Fields */}
                    <div className="space-y-3">
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                        />
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 pr-12 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(v => !v)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        <button
                            onClick={handleAuth}
                            disabled={loading}
                            className="w-full py-4 gradient-emerald rounded-xl font-bold text-black shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-transform disabled:opacity-60 disabled:scale-100"
                        >
                            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'}
                        </button>
                    </div>
                </div>

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
