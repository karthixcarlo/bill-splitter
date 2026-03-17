'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, Users, Receipt, BarChart3, Shield } from 'lucide-react';

const NAV_ITEMS = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/friends', label: 'Friends', icon: Users },
    { href: '/host', label: 'Bills', icon: Receipt },
    { href: '/squads', label: 'Squads', icon: Shield },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export default function NavBar() {
    const pathname = usePathname();

    // Hide nav on auth/onboard/bill/chat pages
    const hiddenPaths = ['/', '/onboard', '/join'];
    if (hiddenPaths.includes(pathname) || pathname.startsWith('/bill/') || pathname.startsWith('/chat/')) return null;

    return (
        <>
            {/* Mobile: fixed bottom bar */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl">
                <div className="flex items-center justify-around py-2">
                    {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                        const isActive = pathname === href;
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all ${
                                    isActive
                                        ? 'text-emerald-400'
                                        : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                            >
                                <Icon className={`w-5 h-5 ${isActive ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : ''}`} />
                                <span className="text-[10px] font-semibold">{label}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>

            {/* Desktop: fixed left sidebar */}
            <nav className="hidden md:flex fixed top-0 left-0 bottom-0 z-40 w-20 lg:w-56 flex-col items-center lg:items-stretch border-r border-zinc-800 bg-zinc-950/95 backdrop-blur-xl py-8 gap-2">
                {/* Brand */}
                <div className="mb-8 px-4">
                    <p className="hidden lg:block text-lg font-black text-emerald-400 tracking-tight">Bro Pay</p>
                    <p className="lg:hidden text-lg font-black text-emerald-400">B</p>
                </div>

                {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                    const isActive = pathname === href;
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 px-4 py-3 mx-2 rounded-xl transition-all ${
                                isActive
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent'
                            }`}
                        >
                            <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : ''}`} />
                            <span className="hidden lg:block text-sm font-semibold">{label}</span>
                        </Link>
                    );
                })}
            </nav>
        </>
    );
}
