'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { BarChart3, TrendingUp, Users, IndianRupee, Utensils, Loader2, Crown, Calendar, Flame, Zap, Shield, Skull, Star, ChevronRight, ChevronLeft } from 'lucide-react';

interface MonthlyData {
    month: string;
    total: number;
    count: number;
}

type WrappedSlide = 'intro' | 'total' | 'chad' | 'enemy' | 'personality' | 'restaurants' | 'monthly' | 'aura';

const SLIDES: WrappedSlide[] = ['intro', 'total', 'chad', 'enemy', 'personality', 'restaurants', 'monthly', 'aura'];

const SLIDE_GRADIENTS: Record<WrappedSlide, string> = {
    intro: 'from-emerald-950 via-zinc-950 to-zinc-950',
    total: 'from-red-950 via-zinc-950 to-zinc-950',
    chad: 'from-amber-950 via-zinc-950 to-zinc-950',
    enemy: 'from-purple-950 via-zinc-950 to-zinc-950',
    personality: 'from-blue-950 via-zinc-950 to-zinc-950',
    restaurants: 'from-orange-950 via-zinc-950 to-zinc-950',
    monthly: 'from-teal-950 via-zinc-950 to-zinc-950',
    aura: 'from-emerald-950 via-zinc-950 to-zinc-950',
};

function getAuraTitle(score: number): { title: string; color: string } {
    if (score >= 90) return { title: 'Sigma Spender', color: 'text-emerald-400' };
    if (score >= 70) return { title: 'Alpha Baller', color: 'text-amber-400' };
    if (score >= 50) return { title: 'Mid Mogging', color: 'text-blue-400' };
    if (score >= 30) return { title: 'NPC Energy', color: 'text-zinc-400' };
    return { title: 'Broke Boi Arc', color: 'text-red-400' };
}

function getPersonality(hostsCount: number, billCount: number, avgBill: number, topFriend: string | null): { title: string; desc: string; icon: typeof Crown } {
    const hostRatio = billCount > 0 ? hostsCount / billCount : 0;
    if (hostRatio > 0.6) return { title: 'The Benefactor', desc: 'You host more than you mooch. Respect.', icon: Crown };
    if (avgBill > 500) return { title: 'The Baller', desc: 'Big bills, big energy. Your wallet is crying.', icon: Zap };
    if (topFriend) return { title: 'The Duo', desc: `You and ${topFriend} are financially inseparable.`, icon: Users };
    if (billCount > 10) return { title: 'The Regular', desc: 'You split bills like you breathe — constantly.', icon: Star };
    return { title: 'The Ghost', desc: 'Barely any bills. Are you even eating?', icon: Skull };
}

export default function AnalyticsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showWrapped, setShowWrapped] = useState(false);

    // Data
    const [totalSpent, setTotalSpent] = useState(0);
    const [billCount, setBillCount] = useState(0);
    const [topRestaurants, setTopRestaurants] = useState<{ name: string; count: number; total: number }[]>([]);
    const [topFriends, setTopFriends] = useState<{ username: string; count: number }[]>([]);
    const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
    const [avgBill, setAvgBill] = useState(0);
    const [hostsCount, setHostsCount] = useState(0);
    const [biggestBill, setBiggestBill] = useState<{ restaurant: string; amount: number } | null>(null);
    const [auraScore, setAuraScore] = useState(0);

    useEffect(() => { loadAnalytics(); }, []);

    async function loadAnalytics() {
        const user = await getCurrentUser();
        if (!user) { router.push('/'); return; }

        try {
            const { data: participations } = await supabase
                .from('participants')
                .select('bill_id')
                .eq('user_id', user.id);

            const billIds = participations?.map(p => p.bill_id) || [];
            if (billIds.length === 0) { setLoading(false); return; }

            const { data: billsData } = await supabase
                .from('bills')
                .select('id,host_id,restaurant_name,created_at,tax_amount,service_charge')
                .in('id', billIds)
                .order('created_at', { ascending: false });

            if (!billsData || billsData.length === 0) { setLoading(false); return; }

            const { data: itemsData } = await supabase
                .from('bill_items')
                .select('id,bill_id,name,total_price')
                .in('bill_id', billIds);

            const { data: claimsData } = await supabase
                .from('claims')
                .select('item_id,share_fraction')
                .eq('user_id', user.id);

            const { data: allParticipants } = await supabase
                .from('participants')
                .select('bill_id,user_id,users(username)')
                .in('bill_id', billIds);

            // Build lookups
            const itemsByBill = new Map<string, { id: string; total_price: number; name: string }[]>();
            for (const item of (itemsData || [])) {
                const list = itemsByBill.get(item.bill_id) || [];
                list.push(item);
                itemsByBill.set(item.bill_id, list);
            }

            const claimMap = new Map<string, number>();
            for (const c of (claimsData || [])) {
                claimMap.set(c.item_id, c.share_fraction ?? 1.0);
            }

            let totalUserSpent = 0;
            let hostCount = 0;
            let maxBill = { restaurant: '', amount: 0 };
            const restaurantMap = new Map<string, { count: number; total: number }>();
            const monthMap = new Map<string, { total: number; count: number }>();

            for (const bill of billsData) {
                const items = itemsByBill.get(bill.id) || [];
                const isHost = bill.host_id === user.id;
                if (isHost) hostCount++;

                let userSubtotal = 0;
                for (const item of items) {
                    const fraction = claimMap.get(item.id);
                    if (fraction !== undefined) {
                        userSubtotal += item.total_price * fraction;
                    }
                }

                const billItemsTotal = items.reduce((s, i) => s + i.total_price, 0);
                const taxShare = billItemsTotal > 0
                    ? (bill.tax_amount + bill.service_charge) * (userSubtotal / billItemsTotal)
                    : 0;
                let userTotal = userSubtotal + taxShare;

                // If user has no claims but is a participant, estimate as equal split
                if (userTotal === 0 && billItemsTotal > 0) {
                    const pCount = (allParticipants || []).filter(p => p.bill_id === bill.id).length || 1;
                    userTotal = (billItemsTotal + (bill.tax_amount || 0) + (bill.service_charge || 0)) / pCount;
                }
                totalUserSpent += userTotal;

                if (userTotal > maxBill.amount) {
                    maxBill = { restaurant: bill.restaurant_name || 'Unknown', amount: userTotal };
                }

                const rName = bill.restaurant_name || 'Unknown';
                const rData = restaurantMap.get(rName) || { count: 0, total: 0 };
                rData.count++;
                rData.total += userTotal;
                restaurantMap.set(rName, rData);

                const date = new Date(bill.created_at);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const mData = monthMap.get(monthKey) || { total: 0, count: 0 };
                mData.total += userTotal;
                mData.count++;
                monthMap.set(monthKey, mData);
            }

            const topR = Array.from(restaurantMap.entries())
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            const friendMap = new Map<string, number>();
            for (const p of (allParticipants || [])) {
                if (p.user_id === user.id) continue;
                const username = (p as any).users?.username || 'Unknown';
                friendMap.set(username, (friendMap.get(username) || 0) + 1);
            }
            const topF = Array.from(friendMap.entries())
                .map(([username, count]) => ({ username, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            const monthlyArr = Array.from(monthMap.entries())
                .map(([month, data]) => ({ month, ...data }))
                .sort((a, b) => a.month.localeCompare(b.month))
                .slice(-6);

            // Aura Score: host ratio (30pts) + consistency (30pts) + social (20pts) + volume (20pts)
            const hostRatio = billsData.length > 0 ? hostCount / billsData.length : 0;
            const hostScore = Math.min(30, hostRatio * 50);
            const consistencyScore = Math.min(30, monthlyArr.length * 5);
            const socialScore = Math.min(20, topF.length * 4);
            const volumeScore = Math.min(20, billsData.length * 2);
            const aura = Math.round(hostScore + consistencyScore + socialScore + volumeScore);

            setTotalSpent(totalUserSpent);
            setBillCount(billsData.length);
            setAvgBill(billsData.length > 0 ? totalUserSpent / billsData.length : 0);
            setHostsCount(hostCount);
            setTopRestaurants(topR);
            setTopFriends(topF);
            setMonthlyData(monthlyArr);
            setBiggestBill(maxBill.amount > 0 ? maxBill : null);
            setAuraScore(aura);
        } catch (err) {
            console.error('Analytics error:', err);
        } finally {
            setLoading(false);
        }
    }

    function formatMonth(key: string) {
        const [y, m] = key.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        );
    }

    const maxMonthly = Math.max(...monthlyData.map(d => d.total), 1);
    const auraInfo = getAuraTitle(auraScore);
    const personality = getPersonality(hostsCount, billCount, avgBill, topFriends[0]?.username || null);
    const PersonalityIcon = personality.icon;
    const slide = SLIDES[currentSlide];

    // ─── Wrapped Slideshow ──────────────────────────────────────────────────────
    if (showWrapped && billCount > 0) {
        return (
            <div
                className={`min-h-screen bg-gradient-to-b ${SLIDE_GRADIENTS[slide]} text-zinc-200 flex flex-col transition-all duration-500`}
                onClick={(e) => {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    if (x > rect.width / 2) {
                        setCurrentSlide(prev => Math.min(prev + 1, SLIDES.length - 1));
                    } else {
                        setCurrentSlide(prev => Math.max(prev - 1, 0));
                    }
                }}
            >
                {/* Progress bar */}
                <div className="flex gap-1 p-4 pb-0">
                    {SLIDES.map((_, i) => (
                        <div key={i} className="flex-1 h-1 rounded-full overflow-hidden bg-zinc-800">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${i <= currentSlide ? 'bg-emerald-500' : 'bg-transparent'}`}
                                style={{ width: i < currentSlide ? '100%' : i === currentSlide ? '100%' : '0%' }}
                            />
                        </div>
                    ))}
                </div>

                {/* Close button */}
                <div className="flex justify-end px-4 pt-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowWrapped(false); setCurrentSlide(0); }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-1"
                    >
                        Exit Wrapped
                    </button>
                </div>

                {/* Slide content */}
                <div className="flex-1 flex items-center justify-center px-6 py-8">
                    <div className="max-w-sm w-full text-center space-y-6 animate-fade-in">

                        {slide === 'intro' && (
                            <>
                                <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <Zap className="w-10 h-10 text-emerald-400" />
                                </div>
                                <h1 className="text-4xl font-black text-white">Your Financial Aura Wrapped</h1>
                                <p className="text-zinc-400 text-lg">Let's see how cooked your wallet is</p>
                                <p className="text-xs text-zinc-600 animate-pulse">tap to continue →</p>
                            </>
                        )}

                        {slide === 'total' && (
                            <>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">You spent a total of</p>
                                <p className="text-6xl font-black text-white">
                                    <span className="text-emerald-400">₹</span>{totalSpent.toFixed(0)}
                                </p>
                                <p className="text-zinc-400">across <span className="text-white font-bold">{billCount}</span> bills</p>
                                <div className="flex justify-center gap-6 pt-4">
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-amber-400">₹{avgBill.toFixed(0)}</p>
                                        <p className="text-xs text-zinc-500">avg per bill</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-purple-400">{hostsCount}</p>
                                        <p className="text-xs text-zinc-500">times hosted</p>
                                    </div>
                                </div>
                            </>
                        )}

                        {slide === 'chad' && (
                            <>
                                <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <Crown className="w-8 h-8 text-amber-400" />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Chad Moment</p>
                                {biggestBill ? (
                                    <>
                                        <p className="text-lg text-zinc-300">Your biggest bill was at</p>
                                        <p className="text-3xl font-black text-amber-400">{biggestBill.restaurant}</p>
                                        <p className="text-5xl font-black text-white">₹{biggestBill.amount.toFixed(0)}</p>
                                        <p className="text-sm text-zinc-500">absolute mogging</p>
                                    </>
                                ) : (
                                    <p className="text-zinc-500">No chad moments yet. Start spending.</p>
                                )}
                            </>
                        )}

                        {slide === 'enemy' && (
                            <>
                                <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <Skull className="w-8 h-8 text-purple-400" />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Public Enemy #1</p>
                                {topFriends[0] ? (
                                    <>
                                        <p className="text-lg text-zinc-300">The person draining your wallet the most</p>
                                        <p className="text-4xl font-black text-purple-400">{topFriends[0].username}</p>
                                        <p className="text-zinc-400"><span className="text-white font-bold">{topFriends[0].count}</span> bills together</p>
                                        <p className="text-xs text-zinc-600">they owe you an apology fr</p>
                                    </>
                                ) : (
                                    <p className="text-zinc-500">No enemies yet. You eat alone.</p>
                                )}
                            </>
                        )}

                        {slide === 'personality' && (
                            <>
                                <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <PersonalityIcon className="w-8 h-8 text-blue-400" />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Your Spending Personality</p>
                                <p className="text-4xl font-black text-blue-400">{personality.title}</p>
                                <p className="text-zinc-400">{personality.desc}</p>
                            </>
                        )}

                        {slide === 'restaurants' && (
                            <>
                                <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <Utensils className="w-8 h-8 text-orange-400" />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Top Restaurants</p>
                                <div className="space-y-3 text-left">
                                    {topRestaurants.slice(0, 3).map((r, i) => (
                                        <div key={r.name} className="flex items-center gap-3 bg-zinc-900/60 rounded-xl p-3">
                                            <span className="text-2xl font-black text-orange-400 w-8">#{i + 1}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-white truncate">{r.name}</p>
                                                <p className="text-xs text-zinc-500">{r.count} visits · ₹{r.total.toFixed(0)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {slide === 'monthly' && (
                            <>
                                <div className="w-16 h-16 bg-teal-500/20 rounded-full flex items-center justify-center mx-auto">
                                    <Calendar className="w-8 h-8 text-teal-400" />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Spending Timeline</p>
                                <div className="flex items-end justify-center gap-3 px-2" style={{ height: '160px' }}>
                                    {monthlyData.map(d => {
                                        const barH = Math.max(6, (d.total / maxMonthly) * 120);
                                        return (
                                            <div key={d.month} className="flex flex-col items-center justify-end h-full" style={{ width: monthlyData.length === 1 ? '60px' : undefined, flex: monthlyData.length > 1 ? '1' : undefined, maxWidth: '80px' }}>
                                                <span className="text-[10px] text-zinc-400 mb-1 font-mono">₹{d.total.toFixed(0)}</span>
                                                <div
                                                    className="w-full bg-gradient-to-t from-teal-600 to-teal-400 transition-all duration-500"
                                                    style={{ height: `${barH}px`, maxHeight: '120px', borderRadius: '4px 4px 0 0' }}
                                                />
                                                <span className="text-[10px] text-zinc-500 mt-1.5">{formatMonth(d.month)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {slide === 'aura' && (
                            <>
                                <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/40">
                                    <span className="text-4xl font-black text-emerald-400">{auraScore}</span>
                                </div>
                                <p className="text-sm text-zinc-500 uppercase tracking-widest font-bold">Your Aura Score</p>
                                <p className={`text-4xl font-black ${auraInfo.color}`}>{auraInfo.title}</p>
                                <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-red-500 via-amber-500 via-blue-500 to-emerald-500 rounded-full transition-all duration-1000"
                                        style={{ width: `${auraScore}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] text-zinc-600">
                                    <span>Broke Boi</span>
                                    <span>NPC</span>
                                    <span>Mid</span>
                                    <span>Alpha</span>
                                    <span>Sigma</span>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowWrapped(false); setCurrentSlide(0); }}
                                    className="mt-4 px-6 py-3 bg-emerald-500 rounded-xl font-bold text-black hover:bg-emerald-400 transition-all"
                                >
                                    Done
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Navigation hints */}
                <div className="flex justify-between px-6 pb-6 text-zinc-600">
                    {currentSlide > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); setCurrentSlide(prev => prev - 1); }} className="flex items-center gap-1 text-xs hover:text-zinc-400">
                            <ChevronLeft className="w-4 h-4" /> Back
                        </button>
                    )}
                    <div className="flex-1" />
                    {currentSlide < SLIDES.length - 1 && (
                        <button onClick={(e) => { e.stopPropagation(); setCurrentSlide(prev => prev + 1); }} className="flex items-center gap-1 text-xs hover:text-zinc-400">
                            Next <ChevronRight className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ─── Dashboard View ─────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-24">
            <div className="max-w-md md:max-w-3xl lg:max-w-5xl mx-auto px-4 pt-10">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Analytics</h1>
                        <p className="text-sm text-zinc-500">Your spending insights</p>
                    </div>
                    {billCount > 0 && (
                        <button
                            onClick={() => setShowWrapped(true)}
                            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl font-bold text-sm text-white hover:from-emerald-500 hover:to-teal-500 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                            <Zap className="w-4 h-4" /> Aura Wrapped
                        </button>
                    )}
                </div>

                {billCount === 0 ? (
                    <div className="py-16 text-center text-zinc-600">
                        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p className="text-sm">No bills yet</p>
                        <p className="text-xs mt-1">Start splitting bills to see your analytics</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Aura Score Card */}
                        <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl p-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-1">Financial Aura</p>
                                    <p className={`text-2xl font-black ${auraInfo.color}`}>{auraInfo.title}</p>
                                </div>
                                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/30">
                                    <span className="text-2xl font-black text-emerald-400">{auraScore}</span>
                                </div>
                            </div>
                            <div className="mt-3 w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full"
                                    style={{ width: `${auraScore}%` }}
                                />
                            </div>
                        </div>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <IndianRupee className="w-4 h-4 text-emerald-400" />
                                    <span className="text-xs text-zinc-500">Total Spent</span>
                                </div>
                                <p className="text-xl font-bold text-white">₹{totalSpent.toFixed(0)}</p>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <BarChart3 className="w-4 h-4 text-blue-400" />
                                    <span className="text-xs text-zinc-500">Bills Split</span>
                                </div>
                                <p className="text-xl font-bold text-white">{billCount}</p>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <TrendingUp className="w-4 h-4 text-amber-400" />
                                    <span className="text-xs text-zinc-500">Avg Per Bill</span>
                                </div>
                                <p className="text-xl font-bold text-white">₹{avgBill.toFixed(0)}</p>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Crown className="w-4 h-4 text-purple-400" />
                                    <span className="text-xs text-zinc-500">Times Hosted</span>
                                </div>
                                <p className="text-xl font-bold text-white">{hostsCount}</p>
                            </div>
                        </div>

                        {/* Monthly Spending Bar Chart */}
                        {monthlyData.length > 0 && (
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Calendar className="w-4 h-4 text-emerald-400" />
                                    <h3 className="text-sm font-semibold text-white">Monthly Spending</h3>
                                </div>
                                <div className="flex items-end justify-center gap-3" style={{ height: '128px' }}>
                                    {monthlyData.map(d => {
                                        const barH = Math.max(6, (d.total / maxMonthly) * 96);
                                        return (
                                            <div key={d.month} className="flex flex-col items-center justify-end h-full" style={{ width: monthlyData.length === 1 ? '60px' : undefined, flex: monthlyData.length > 1 ? '1' : undefined, maxWidth: '80px' }}>
                                                <span className="text-[10px] text-zinc-400 mb-1 font-mono">₹{d.total.toFixed(0)}</span>
                                                <div
                                                    className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-500"
                                                    style={{ height: `${barH}px`, maxHeight: '96px', borderRadius: '4px 4px 0 0' }}
                                                />
                                                <span className="text-[10px] text-zinc-500 mt-1.5">{formatMonth(d.month)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Two-column layout for restaurants and friends */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {topRestaurants.length > 0 && (
                                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Utensils className="w-4 h-4 text-amber-400" />
                                        <h3 className="text-sm font-semibold text-white">Top Restaurants</h3>
                                    </div>
                                    <div className="space-y-3">
                                        {topRestaurants.map((r, i) => (
                                            <div key={r.name} className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-zinc-600 w-4">{i + 1}</span>
                                                    <span className="text-sm text-zinc-300 truncate max-w-[140px]">{r.name}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-xs text-zinc-500">{r.count}x</span>
                                                    <span className="text-xs text-emerald-400 ml-2">₹{r.total.toFixed(0)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {topFriends.length > 0 && (
                                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Users className="w-4 h-4 text-blue-400" />
                                        <h3 className="text-sm font-semibold text-white">Top Co-Diners</h3>
                                    </div>
                                    <div className="space-y-3">
                                        {topFriends.map((f, i) => (
                                            <div key={f.username} className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-bold text-zinc-600 w-4">{i + 1}</span>
                                                    <div className="w-6 h-6 bg-zinc-700 rounded-full flex items-center justify-center text-[10px] text-zinc-300 font-bold">
                                                        {f.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-sm text-zinc-300">{f.username}</span>
                                                </div>
                                                <span className="text-xs text-zinc-500">{f.count} bills</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
