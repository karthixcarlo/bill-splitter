'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinPage() {
    const router = useRouter();
    const [billId, setBillId] = useState('');

    function handleJoin() {
        if (billId.trim()) {
            router.push(`/bill/${billId.trim()}`);
        }
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center p-6 relative overflow-hidden">

            {/* Background Pattern */}
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none" />

            <div className="w-full max-w-md space-y-6 relative z-10">
                <div className="space-y-2 text-center md:text-left">
                    <h1 className="text-4xl font-bold text-white tracking-tight">Join a Bill</h1>
                    <p className="text-zinc-400 text-lg">
                        Enter the bill code shared by your friend
                    </p>
                </div>

                <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 p-8 rounded-2xl space-y-6 shadow-2xl">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-zinc-300 uppercase tracking-wider">Bill Code</label>
                        <input
                            type="text"
                            value={billId}
                            onChange={(e) => setBillId(e.target.value)}
                            placeholder="e.g. 550e8400..."
                            className="w-full px-4 py-4 bg-zinc-950/50 border border-zinc-800 rounded-xl focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono text-lg tracking-wide placeholder:text-zinc-700"
                            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                            autoFocus
                        />
                    </div>

                    <button
                        onClick={handleJoin}
                        disabled={!billId.trim()}
                        className="w-full py-4 gradient-emerald rounded-xl font-bold text-black text-lg shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:shadow-none disabled:hover:scale-100"
                    >
                        Join Party
                    </button>
                </div>

                <div className="text-center">
                    <button
                        onClick={() => router.push('/')}
                        className="text-sm text-zinc-500 hover:text-emerald-500 transition-colors font-medium flex items-center justify-center gap-2 mx-auto group"
                    >
                        <span className="group-hover:-translate-x-1 transition-transform">←</span> Back to Home
                    </button>
                </div>
            </div>
        </div>
    );
}
