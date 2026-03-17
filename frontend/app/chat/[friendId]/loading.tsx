import { Loader2 } from 'lucide-react';

export default function ChatLoading() {
    return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
            <div className="text-center space-y-4">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
                <p className="text-zinc-400 text-sm">Loading chat...</p>
            </div>
        </div>
    );
}
