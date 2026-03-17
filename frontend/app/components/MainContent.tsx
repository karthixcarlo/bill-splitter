'use client';

import { usePathname } from 'next/navigation';

const HIDDEN_NAV_PATHS = ['/', '/onboard', '/join'];

export default function MainContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    const hasNav = !HIDDEN_NAV_PATHS.includes(pathname)
        && !pathname.startsWith('/bill/')
        && !pathname.startsWith('/chat/');

    return (
        <div className={hasNav ? 'md:ml-20 lg:ml-56' : ''}>
            {children}
        </div>
    );
}
