'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Loader2, Users, Share2, CheckCircle, IndianRupee } from 'lucide-react';

interface BillItem {
    id: string;
    name: string;
    quantity: number;
    price_per_unit: number;
    total_price: number;
}

const LOCAL_USER_ID = 'local_user';

export default function BillPage() {
    const params = useParams();
    const router = useRouter();
    const billId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [bill, setBill] = useState<any>(null);
    const [items, setItems] = useState<BillItem[]>([]);
    // claimedIds = set of item.id strings the local user claimed
    const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
    const [hostUpi, setHostUpi] = useState('');
    const [showUpiInput, setShowUpiInput] = useState(false);

    // ─── Load bill on mount ──────────────────────────────────────────────────
    useEffect(() => {
        loadBillData();
    }, [billId]);

    // Persist claims to localStorage whenever they change
    useEffect(() => {
        if (!billId) return;
        localStorage.setItem(
            `claims_${billId}`,
            JSON.stringify([...claimedIds])
        );
    }, [claimedIds, billId]);

    async function loadBillData() {
        try {
            // 1. localStorage (bills created via dev bypass)
            const localData = localStorage.getItem(`bill_${billId}`);
            if (localData) {
                const parsed = JSON.parse(localData);
                setBill(parsed);
                setItems(parsed.items || []);
                // Restore previously claimed items
                const savedClaims = localStorage.getItem(`claims_${billId}`);
                if (savedClaims) setClaimedIds(new Set(JSON.parse(savedClaims)));
                setLoading(false);
                return;
            }

            // 2. Supabase fallback
            const { data: billData, error } = await supabase
                .from('bills')
                .select('*')
                .eq('id', billId)
                .single();

            if (error || !billData) {
                alert('Bill not found. Make sure you have the right link.');
                router.push('/');
                return;
            }
            setBill(billData);

            const { data: itemsData } = await supabase
                .from('bill_items')
                .select('*')
                .eq('bill_id', billId);
            setItems(itemsData || []);

            const savedClaims = localStorage.getItem(`claims_${billId}`);
            if (savedClaims) setClaimedIds(new Set(JSON.parse(savedClaims)));

        } catch (err) {
            console.error('Error loading bill:', err);
        } finally {
            setLoading(false);
        }
    }

    // ─── Toggle claim locally ────────────────────────────────────────────────
    function toggleClaim(itemId: string) {
        setClaimedIds(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
        });
    }

    // ─── Calculate user's share ──────────────────────────────────────────────
    const myItemsTotal = items
        .filter(i => claimedIds.has(i.id))
        .reduce((sum, i) => sum + i.total_price, 0);

    const billTotal = bill?.total || items.reduce((s, i) => s + i.total_price, 0);
    const taxShare = billTotal > 0
        ? ((bill?.tax_amount || 0) + (bill?.service_charge || 0)) * (myItemsTotal / billTotal)
        : 0;
    const myTotal = myItemsTotal + taxShare;

    // ─── Share / UPI helpers ─────────────────────────────────────────────────
    async function handleShare() {
        const url = `${window.location.origin}/bill/${billId}`;
        if (navigator.share) {
            await navigator.share({ title: 'Join Bill Split', url });
        } else {
            await navigator.clipboard.writeText(url);
            alert('Link copied! Share it with your friends.');
        }
    }

    function handlePay() {
        if (myTotal === 0) {
            alert('Please select at least one item first!');
            return;
        }
        if (!hostUpi) {
            setShowUpiInput(true);
            return;
        }
        openUpi(hostUpi);
    }

    function openUpi(upiId: string) {
        const amount = myTotal.toFixed(2);
        const note = encodeURIComponent(`Bill split - ${bill?.restaurant_name || 'Restaurant'}`);
        const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${amount}&cu=INR&tn=${note}`;
        window.location.href = upiUrl;
        setTimeout(() => {
            // Desktop fallback: show the URL
            navigator.clipboard.writeText(upiUrl).catch(() => { });
            alert(`UPI link: ${upiUrl}\n\nShare this with someone on mobile to pay.`);
        }, 1500);
    }

    // ─── Render ──────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-48 relative overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none fixed" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none fixed" />

            {/* Header */}
            <div className="sticky top-0 z-20 glass border-b border-zinc-800 p-4 backdrop-blur-xl">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-white">
                            {bill?.restaurant_name || 'Bill Split'}
                        </h1>
                        <p className="text-sm text-zinc-400 flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {claimedIds.size} item{claimedIds.size !== 1 ? 's' : ''} selected
                        </p>
                    </div>
                    <button
                        onClick={handleShare}
                        className="p-3 bg-zinc-800/80 rounded-lg hover:bg-emerald-500 hover:text-black transition-all"
                    >
                        <Share2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Instruction banner */}
            <div className="max-w-md mx-auto px-4 pt-4 relative z-10">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-sm text-emerald-300 text-center">
                    👆 Tap items you ordered to claim them
                </div>
            </div>

            {/* Items */}
            <div className="max-w-md mx-auto p-4 space-y-3 relative z-10">
                {items.map((item) => {
                    const claimed = claimedIds.has(item.id);
                    return (
                        <button
                            key={item.id}
                            onClick={() => toggleClaim(item.id)}
                            className={`w-full p-4 rounded-xl text-left transition-all border active:scale-[0.98] ${claimed
                                ? 'bg-emerald-500/15 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                                : 'bg-zinc-900/60 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-600'
                                }`}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${claimed
                                        ? 'bg-emerald-500 border-emerald-500'
                                        : 'border-zinc-600'
                                        }`}>
                                        {claimed && <CheckCircle className="w-3 h-3 text-black" />}
                                    </div>
                                    <div>
                                        <h3 className={`font-semibold ${claimed ? 'text-emerald-400' : 'text-zinc-200'}`}>
                                            {item.name}
                                        </h3>
                                        <p className="text-xs text-zinc-500">Qty: {item.quantity}</p>
                                    </div>
                                </div>
                                <p className={`font-bold font-mono ${claimed ? 'text-emerald-300' : 'text-zinc-100'}`}>
                                    ₹{item.total_price.toFixed(2)}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* UPI input modal */}
            {showUpiInput && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4">
                        <h3 className="text-lg font-bold text-white">Enter Host's UPI ID</h3>
                        <p className="text-sm text-zinc-400">Ask the person who created this bill for their UPI ID</p>
                        <input
                            type="text"
                            placeholder="e.g. name@upi or 9876543210@paytm"
                            value={hostUpi}
                            onChange={e => setHostUpi(e.target.value)}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowUpiInput(false)}
                                className="flex-1 py-3 border border-zinc-700 rounded-xl text-zinc-300 hover:bg-zinc-800"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { setShowUpiInput(false); if (hostUpi) openUpi(hostUpi); }}
                                className="flex-1 py-3 gradient-emerald rounded-xl font-bold text-black"
                                disabled={!hostUpi.trim()}
                            >
                                Pay ₹{myTotal.toFixed(2)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Fixed Bottom Bar */}
            <div className="fixed bottom-0 left-0 right-0 glass border-t border-zinc-800 p-4 z-20 backdrop-blur-xl bg-zinc-950/80">
                <div className="max-w-md mx-auto space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Your Items</span>
                        <span className="font-medium text-zinc-200">₹{myItemsTotal.toFixed(2)}</span>
                    </div>
                    {taxShare > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-400">Tax & Charges (your share)</span>
                            <span className="font-medium text-zinc-200">₹{taxShare.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
                        <span className="text-lg font-bold text-white">Total</span>
                        <span className="text-2xl font-bold text-emerald-400 font-mono">
                            ₹{myTotal.toFixed(2)}
                        </span>
                    </div>

                    <button
                        onClick={handlePay}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${myTotal > 0
                            ? 'gradient-emerald text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02]'
                            : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            }`}
                    >
                        <IndianRupee className="w-5 h-5" />
                        {myTotal > 0 ? `Pay ₹${myTotal.toFixed(2)}` : 'Select items to pay'}
                    </button>
                </div>
            </div>
        </div>
    );
}
