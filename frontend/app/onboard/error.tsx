'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function OnboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Onboard page error:', error);
    }, [error]);

    return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>
                <h2 className="text-xl font-bold text-white">Something went wrong</h2>
                <p className="text-zinc-400 text-sm">
                    Failed to load onboarding. Please try again.
                </p>
                <button
                    onClick={reset}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold inline-flex items-center gap-2 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                </button>
            </div>
        </div>
    );
}
