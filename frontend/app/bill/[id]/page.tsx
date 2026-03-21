import type { Metadata } from 'next';
import BillRoom from './BillRoom';

interface Props {
    params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    // Server component: use server-side API_URL (no NEXT_PUBLIC_ needed).
    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    try {
        const res = await fetch(`${apiUrl}/api/bills/${params.id}`, {
            next: { revalidate: 60 },
        });
        if (!res.ok) throw new Error('Bill not found');
        const bill = await res.json();

        const itemCount = bill.items?.length ?? 0;
        const participantCount = bill.participants?.length ?? 0;
        const total = bill.items?.reduce((s: number, i: any) => s + (i.total_price || 0), 0) + (bill.tax_amount || 0) + (bill.service_charge || 0);

        const title = `${bill.restaurant_name || 'Bill'} — Bro Please Pay`;
        const description = `Split ₹${total?.toFixed(0) || '?'} across ${participantCount} people (${itemCount} items). Claim your share and pay via UPI.`;

        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
        const ogParams = new URLSearchParams({
            restaurant: bill.restaurant_name || 'Bill Split',
            total: total?.toFixed(0) || '0',
            participants: String(participantCount),
            ...(bill.ai_roast ? { roast: bill.ai_roast } : {}),
        });
        const ogImage = `${siteUrl}/api/og?${ogParams.toString()}`;

        return {
            title,
            description,
            openGraph: {
                title,
                description,
                type: 'website',
                siteName: 'Bro Please Pay',
                images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
            },
            twitter: {
                card: 'summary_large_image',
                title,
                description,
                images: [ogImage],
            },
        };
    } catch {
        return {
            title: 'Split Bill — Bro Please Pay',
            description: 'AI-powered bill splitting with instant UPI payments.',
        };
    }
}

export default function BillPage() {
    return <BillRoom />;
}
