'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser, getUserProfile, API_URL } from '@/lib/supabase';
import {
    Loader2, Plus, TrendingUp, Clock, Users, ChevronRight,
    UtensilsCrossed, X, Zap, MessageCircle, Crown, Skull, TrendingDown,
    Sparkles, Settings, Save, MoreVertical, Pencil, Trash2, LogOut,
    User, Flame, Star, ChevronDown, Hourglass, Handshake, Lock,
    AlertTriangle,
} from 'lucide-react';
import AuraBadge from '@/app/components/AuraBadge';

interface BillSummary {
    id: string;
    restaurant_name: string;
    created_at: string;
    my_total: number;
    host_id: string;
    host_name?: string;
    isNew?: boolean;
    leave_requested?: boolean;
    escape_count?: number;
}

interface Friend {
    id: string;
    username: string;
    upi_vpa: string | null;
    avatar_url: string | null;
    vibe: string | null;
}

export default function HomePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<any>(null);
    const [userId, setUserId] = useState('');
    const [monthlySpend, setMonthlySpend] = useState(0);
    const [recentBills, setRecentBills] = useState<BillSummary[]>([]);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [activeTab, setActiveTab] = useState<'bills' | 'friends'>('bills');
    const [dataError, setDataError] = useState('');

    // Friend profile modal
    const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
    const [sharedSpend, setSharedSpend] = useState<number | null>(null);
    const [sharedSpendLoading, setSharedSpendLoading] = useState(false);

    // Aura metrics
    const [billsHosted, setBillsHosted] = useState<number | null>(null);
    const [maxItemClaimed, setMaxItemClaimed] = useState<number | null>(null);

    // Edit Profile modal
    const [showEditProfile, setShowEditProfile] = useState(false);
    const [editVpa, setEditVpa] = useState('');
    const [editVibe, setEditVibe] = useState('');
    const [editSnitchName, setEditSnitchName] = useState('');
    const [editSnitchPhone, setEditSnitchPhone] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    const [editSuccess, setEditSuccess] = useState(false);

    // Avatar dropdown
    const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

    // Bill management
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [editBillId, setEditBillId] = useState<string | null>(null);
    const [editBillName, setEditBillName] = useState('');
    const [toast, setToast] = useState('');

    // Track known bill IDs so Realtime doesn't re-inject existing ones
    const knownBillIds = useRef<Set<string>>(new Set());

    // Close dropdown menus when clicking outside
    useEffect(() => {
        if (!menuOpenId && !avatarMenuOpen) return;
        const handler = () => { setMenuOpenId(null); setAvatarMenuOpen(false); };
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [menuOpenId, avatarMenuOpen]);

    async function handleLogout() {
        await supabase.auth.signOut();
        router.push('/');
    }

    useEffect(() => {
        async function init() {
            const user = await getCurrentUser();
            if (!user) { router.push('/'); return; }
            try {
                const p = await getUserProfile(user.id);
                if (!p?.upi_vpa) { router.push('/onboard'); return; }
                setProfile(p);
                setUserId(user.id);
                await Promise.all([
                    loadMonthlyData(user.id),
                    loadFriends(user.id),
                ]);
            } catch {
                router.push('/onboard');
            } finally {
                setLoading(false);
            }
        }
        init();
    }, []);

    // ─── Realtime: listen for new participant rows (= someone added me to a bill) ──
    useEffect(() => {
        if (!userId) return;

        const channel = supabase
            .channel('dashboard_invites')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'participants',
                    filter: `user_id=eq.${userId}`,
                },
                async (payload) => {
                    console.log('[dashboard] Realtime INSERT on participants:', payload);
                    const newBillId = payload.new?.bill_id;
                    if (!newBillId || knownBillIds.current.has(newBillId)) return;

                    // Fetch the new bill's details via backend API (bypasses RLS)
                    try {
                        const apiUrl = API_URL;
                        const res = await fetch(`${apiUrl}/api/bills/${newBillId}`);
                        if (!res.ok) return;
                        const bill = await res.json();

                        knownBillIds.current.add(newBillId);
                        // Prepend to recent bills with "New" badge
                        setRecentBills(prev => [
                            {
                                id: bill.id,
                                restaurant_name: bill.restaurant_name || 'Restaurant',
                                created_at: bill.created_at || new Date().toISOString(),
                                my_total: 0,
                                host_id: bill.host_id || '',
                                isNew: true,
                            },
                            ...prev.filter(b => b.id !== newBillId),
                        ]);

                        // Auto-clear "New" badge after 5 seconds
                        setTimeout(() => {
                            setRecentBills(prev =>
                                prev.map(b => b.id === newBillId ? { ...b, isNew: false } : b)
                            );
                        }, 5000);
                    } catch (err) {
                        console.warn('[dashboard] Failed to fetch new bill:', err);
                    }
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [userId]);

    // ─── Re-fetch on tab focus (handles return from UPI app, other pages) ────
    useEffect(() => {
        if (!userId) return;
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                loadMonthlyData(userId);
                loadFriends(userId);
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [userId]);

    // ─── Data fetching ────────────────────────────────────────────────────────

    async function loadMonthlyData(uid: string) {
        try {
            console.log('[dashboard] FETCHING BILLS FOR USER:', uid);

            // Two parallel queries to catch ALL bills (hosted + joined)
            const [hostedRes, joinedRes] = await Promise.all([
                supabase.from('bills')
                    .select('id, restaurant_name, tax_amount, service_charge, created_at, host_id, users(username), participants(user_id, leave_requested)')
                    .eq('host_id', uid)
                    .order('created_at', { ascending: false })
                    .limit(20),
                supabase.from('participants')
                    .select('bill_id, leave_requested, bills(id, restaurant_name, tax_amount, service_charge, created_at, host_id, users(username), participants(user_id, leave_requested))')
                    .eq('user_id', uid),
            ]);

            if (hostedRes.error) console.error('[dashboard] hosted query FAILED:', hostedRes.error);
            if (joinedRes.error) console.error('[dashboard] joined query FAILED:', joinedRes.error);

            // Merge & deduplicate
            const billMap = new Map<string, any>();
            const leaveStatusMap = new Map<string, boolean>();

            for (const bill of (hostedRes.data ?? []) as any[]) {
                billMap.set(bill.id, bill);
            }
            for (const row of (joinedRes.data ?? []) as any[]) {
                const bill = row.bills;
                if (bill && !billMap.has(bill.id)) billMap.set(bill.id, bill);
                leaveStatusMap.set(row.bill_id, row.leave_requested ?? false);
            }

            const bills = Array.from(billMap.values())
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 20);

            console.log('[dashboard] merged bills count:', bills.length);
            if (!bills.length) { setMonthlySpend(0); setRecentBills([]); return; }

            // Fetch items for all bills
            const billIds = bills.map((b: any) => b.id);
            const { data: allItems } = await supabase
                .from('bill_items')
                .select('id, bill_id, total_price')
                .in('bill_id', billIds);

            // Fetch user's claims for these items
            const itemIds = (allItems ?? []).map((i: any) => i.id);
            const { data: allClaims } = itemIds.length
                ? await supabase
                    .from('claims')
                    .select('item_id, share_fraction')
                    .eq('user_id', uid)
                    .in('item_id', itemIds)
                : { data: [] };

            const itemMap = new Map((allItems ?? []).map((i: any) => [i.id, i]));

            // Per-bill subtotals from claims
            const billSubtotals = new Map<string, number>();
            for (const claim of (allClaims ?? []) as any[]) {
                const item = itemMap.get(claim.item_id);
                if (!item) continue;
                const prev = billSubtotals.get(item.bill_id) ?? 0;
                billSubtotals.set(item.bill_id, prev + Number(item.total_price) * claim.share_fraction);
            }

            // Build summaries for ALL recent bills + calculate monthly spend
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            let totalMonthlySpend = 0;
            const summaries: BillSummary[] = [];

            for (const bill of bills as any[]) {
                const subtotal = billSubtotals.get(bill.id) ?? 0;
                const billItemsTotal = (allItems ?? [])
                    .filter((i: any) => i.bill_id === bill.id)
                    .reduce((s: number, i: any) => s + Number(i.total_price), 0);
                const taxShare = billItemsTotal > 0
                    ? (Number(bill.tax_amount) + Number(bill.service_charge)) * (subtotal / billItemsTotal)
                    : 0;
                const myTotal = subtotal + taxShare;

                if (new Date(bill.created_at) >= startOfMonth) {
                    totalMonthlySpend += myTotal;
                }

                // Count escape requests from participants array (host sees this)
                const escapeCount = (bill.participants ?? []).filter((p: any) => p.leave_requested === true && p.user_id !== uid).length;

                summaries.push({
                    id: bill.id,
                    restaurant_name: bill.restaurant_name || 'Restaurant',
                    created_at: bill.created_at,
                    my_total: myTotal,
                    host_id: bill.host_id,
                    host_name: bill.users?.username || 'Host',
                    leave_requested: leaveStatusMap.get(bill.id) ?? false,
                    escape_count: escapeCount,
                });
            }

            setMonthlySpend(totalMonthlySpend);
            setRecentBills(summaries);

            // Seed known IDs so Realtime doesn't re-inject these
            for (const s of summaries) knownBillIds.current.add(s.id);
        } catch (err) {
            console.error('[dashboard] loadMonthlyData crashed:', err);
            setDataError('Supabase query failed. Check connection.');
        }
    }

    async function loadFriends(uid: string) {
        // Fetch actual accepted friendships, not all users
        const { data: friendships } = await supabase
            .from('friendships')
            .select('user_id_1, user_id_2, status')
            .or(`user_id_1.eq.${uid},user_id_2.eq.${uid}`);

        const accepted = (friendships || []).filter(f => f.status === 'accepted');
        const friendIds = accepted.map(f => f.user_id_1 === uid ? f.user_id_2 : f.user_id_1);
        if (friendIds.length === 0) { setFriends([]); return; }

        const { data: profiles, error } = await supabase
            .from('users')
            .select('id, username, upi_vpa, avatar_url, vibe')
            .in('id', friendIds)
            .order('username');

        if (!error && profiles) setFriends(profiles as Friend[]);
    }

    async function handleFriendClick(friend: Friend) {
        setSelectedFriend(friend);
        setSharedSpend(null);
        setBillsHosted(null);
        setMaxItemClaimed(null);
        setSharedSpendLoading(true);
        await Promise.all([
            loadSharedSpend(friend.id),
            loadFriendMetrics(friend.id),
        ]);
        setSharedSpendLoading(false);
    }

    async function loadFriendMetrics(friendId: string) {
        try {
            // Count bills hosted
            const { data: hosted, count } = await supabase
                .from('bills')
                .select('id', { count: 'exact', head: true })
                .eq('host_id', friendId);
            setBillsHosted(count ?? 0);

            // Biggest single item claimed
            const { data: claimsData } = await supabase
                .from('claims')
                .select('share_fraction, bill_items(total_price)')
                .eq('user_id', friendId)
                .limit(200);

            if (claimsData?.length) {
                const max = Math.max(...(claimsData as any[]).map((c: any) => {
                    const itemPrice = c.bill_items?.total_price ?? 0;
                    return Number(itemPrice) * (c.share_fraction ?? 1);
                }));
                setMaxItemClaimed(max > 0 ? max : 0);
            } else {
                setMaxItemClaimed(0);
            }
        } catch {
            setBillsHosted(0);
            setMaxItemClaimed(0);
        }
    }

    function openCrashout(friend: Friend) {
        router.push(`/chat/${friend.id}`);
    }

    function getAuraScore(): number {
        const hosted = billsHosted ?? 0;
        const debt = sharedSpend ?? 0;
        return hosted * 100 - (debt > 300 ? Math.floor(debt / 5) : 0);
    }

    function getAuraBadges(): Array<{ iconType: 'crown' | 'flame' | 'trending-down' | 'star'; label: string; color: string }> {
        const badges: Array<{ iconType: 'crown' | 'flame' | 'trending-down' | 'star'; label: string; color: string }> = [];
        const hosted = billsHosted ?? 0;
        const maxItem = maxItemClaimed ?? 0;
        const debt = sharedSpend ?? 0;
        if (hosted > 3) badges.push({ iconType: 'crown', label: 'Chad +1000 Aura', color: 'text-amber-400 border-amber-500/40 bg-amber-500/10' });
        if (maxItem > 500) badges.push({ iconType: 'flame', label: 'Gremlin Mode', color: 'text-red-400 border-red-500/40 bg-red-500/10' });
        if (debt > 500) badges.push({ iconType: 'trending-down', label: 'Broke Boi', color: 'text-zinc-400 border-zinc-600/40 bg-zinc-800/40' });
        if (badges.length === 0 && hosted > 0) badges.push({ iconType: 'star', label: 'Solid Guy', color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' });
        return badges;
    }

    function BadgeIcon({ type }: { type: string }) {
        switch (type) {
            case 'crown': return <Crown className="w-3 h-3" />;
            case 'flame': return <Flame className="w-3 h-3" />;
            case 'trending-down': return <TrendingDown className="w-3 h-3" />;
            case 'star': return <Star className="w-3 h-3" />;
            default: return null;
        }
    }

    async function loadSharedSpend(friendId: string) {
        try {
            // Bills I'm in + bills friend is in (participants is single source of truth)
            const [{ data: myParts }, { data: friendParts }] = await Promise.all([
                supabase.from('participants').select('bill_id').eq('user_id', userId),
                supabase.from('participants').select('bill_id').eq('user_id', friendId),
            ]);
            const myBillIds = new Set((myParts ?? []).map((p: any) => p.bill_id));
            const friendBillIds = new Set((friendParts ?? []).map((p: any) => p.bill_id));

            // Intersection — bills shared between both
            const sharedBillIds = Array.from(myBillIds).filter(id => friendBillIds.has(id));
            if (!sharedBillIds.length) { setSharedSpend(0); return; }

            // Items in shared bills + my claims
            const { data: items } = await supabase
                .from('bill_items')
                .select('id, bill_id, total_price')
                .in('bill_id', sharedBillIds);

            if (!items?.length) { setSharedSpend(0); return; }

            const itemIds = (items as any[]).map(i => i.id);
            const [{ data: myClaims }, { data: sharedBills }] = await Promise.all([
                supabase.from('claims').select('item_id, share_fraction').eq('user_id', userId).in('item_id', itemIds),
                supabase.from('bills').select('id, tax_amount, service_charge').in('id', sharedBillIds),
            ]);

            const itemMap = new Map((items as any[]).map(i => [i.id, i]));
            const billSubtotals = new Map<string, number>();
            for (const claim of (myClaims ?? []) as any[]) {
                const item = itemMap.get(claim.item_id);
                if (!item) continue;
                const prev = billSubtotals.get(item.bill_id) ?? 0;
                billSubtotals.set(item.bill_id, prev + Number(item.total_price) * claim.share_fraction);
            }

            let total = 0;
            for (const bill of (sharedBills ?? []) as any[]) {
                const subtotal = billSubtotals.get(bill.id) ?? 0;
                const billItemsTotal = (items as any[])
                    .filter(i => i.bill_id === bill.id)
                    .reduce((s: number, i: any) => s + Number(i.total_price), 0);
                const taxShare = billItemsTotal > 0
                    ? (Number(bill.tax_amount) + Number(bill.service_charge)) * (subtotal / billItemsTotal)
                    : 0;
                total += subtotal + taxShare;
            }
            setSharedSpend(total);
        } catch {
            setSharedSpend(0);
        }
    }

    // ─── Bill Management ────────────────────────────────────────────────────────

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }

    async function handleDeleteBill(billId: string) {
        if (!confirm('Delete this bill and all its data? This cannot be undone.')) return;
        setMenuOpenId(null);
        try {
            const apiUrl = API_URL;
            // Use backend to delete (service role bypasses RLS + handles cascading)
            const { error: claimsErr } = await supabase.from('claims').delete().in('item_id',
                (await supabase.from('bill_items').select('id').eq('bill_id', billId)).data?.map((i: any) => i.id) || []
            );
            await supabase.from('bill_items').delete().eq('bill_id', billId);
            await supabase.from('participants').delete().eq('bill_id', billId);
            const { error } = await supabase.from('bills').delete().eq('id', billId);
            if (error) throw error;
            setRecentBills(prev => prev.filter(b => b.id !== billId));
            showToast('Bill deleted');
        } catch (err) {
            console.error('[dashboard] delete bill failed:', err);
            alert('Failed to delete bill');
        }
    }

    async function handleRequestLeave(billId: string) {
        setMenuOpenId(null);
        try {
            const { error } = await supabase
                .from('participants')
                .update({ leave_requested: true })
                .match({ bill_id: billId, user_id: userId });
            if (error) throw error;
            setRecentBills(prev => prev.map(b =>
                b.id === billId ? { ...b, leave_requested: true } : b
            ));
            showToast('Escape request sent to the Host. You are locked in until approved.');
        } catch (err) {
            console.error('[dashboard] request leave failed:', err);
            alert('Failed to request leave');
        }
    }

    function openEditBillName(bill: BillSummary) {
        setMenuOpenId(null);
        setEditBillId(bill.id);
        setEditBillName(bill.restaurant_name);
    }

    async function handleSaveBillName() {
        if (!editBillId || !editBillName.trim()) return;
        try {
            const { error } = await supabase
                .from('bills')
                .update({ restaurant_name: editBillName.trim() })
                .eq('id', editBillId);
            if (error) throw error;
            setRecentBills(prev => prev.map(b =>
                b.id === editBillId ? { ...b, restaurant_name: editBillName.trim() } : b
            ));
            setEditBillId(null);
            showToast('Bill name updated');
        } catch (err) {
            console.error('[dashboard] update bill name failed:', err);
            alert('Failed to update bill name');
        }
    }

    // ─── Edit Profile ──────────────────────────────────────────────────────────

    function openEditProfile() {
        setEditVpa(profile?.upi_vpa || '');
        setEditVibe(profile?.vibe || '');
        setEditSnitchName(profile?.snitch_name || '');
        setEditSnitchPhone(profile?.snitch_phone || '');
        setEditSuccess(false);
        setShowEditProfile(true);
    }

    async function handleSaveProfile() {
        if (!editVpa.trim()) return;
        setEditSaving(true);
        try {
            const updates: any = {
                upi_vpa: editVpa.trim(),
                vibe: editVibe || null,
                snitch_name: editSnitchName.trim() || null,
                snitch_phone: editSnitchPhone.trim() || null,
            };
            const { error } = await supabase
                .from('users')
                .update(updates)
                .eq('id', userId);
            if (error) throw error;
            setProfile((prev: any) => ({ ...prev, ...updates }));
            setEditSuccess(true);
            setTimeout(() => setShowEditProfile(false), 1200);
        } catch (err) {
            console.error('[edit-profile] save failed:', err);
            alert('Failed to save profile');
        } finally {
            setEditSaving(false);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function formatDate(iso: string) {
        return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }

    function monthName() {
        return new Date().toLocaleString('en-IN', { month: 'long' });
    }

    function avatarInitial(name: string) {
        return name?.[0]?.toUpperCase() ?? '?';
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-24 relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none fixed" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none fixed" />

            <div className="max-w-md md:max-w-3xl lg:max-w-5xl mx-auto px-4 pt-10 space-y-6 relative z-10">

                {/* Greeting + Avatar Dropdown */}
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-zinc-500 text-sm">Welcome back,</p>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold text-white">{profile?.username || 'Friend'}</h1>
                            {profile?.aura_score != null && <AuraBadge score={profile.aura_score} size="md" showLabel />}
                        </div>
                        {profile?.vibe && (
                            <p className="text-xs text-zinc-500 italic mt-0.5">"{profile.vibe}"</p>
                        )}
                    </div>
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setAvatarMenuOpen(!avatarMenuOpen); }}
                            className="flex items-center gap-1.5 group"
                        >
                            <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-black text-lg ring-2 ring-transparent group-hover:ring-emerald-400/40 transition-all">
                                {avatarInitial(profile?.username || 'F')}
                            </div>
                            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${avatarMenuOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {avatarMenuOpen && (
                            <div className="absolute right-0 top-12 w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-30">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setAvatarMenuOpen(false); openEditProfile(); }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors"
                                >
                                    <User className="w-4 h-4 text-zinc-400" /> Edit Profile
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setAvatarMenuOpen(false); openEditProfile(); }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors border-t border-zinc-800"
                                >
                                    <Settings className="w-4 h-4 text-zinc-400" /> Settings
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-zinc-800"
                                >
                                    <LogOut className="w-4 h-4" /> Logout
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Monthly Burn Card */}
                <div className="relative rounded-2xl overflow-hidden border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-zinc-900/80 to-zinc-900 p-6 shadow-[0_0_40px_rgba(16,185,129,0.08)]">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">Total Spent in {monthName()}</p>
                            <div className="flex items-end gap-1 mt-2">
                                <span className="text-zinc-400 text-xl font-bold">₹</span>
                                <span className="text-5xl font-black text-white tracking-tight">
                                    {monthlySpend.toFixed(0)}
                                </span>
                                <span className="text-zinc-500 text-sm mb-1">.{(monthlySpend % 1).toFixed(2).slice(2)}</span>
                            </div>
                        </div>
                        <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                        </div>
                    </div>
                    <div className="flex items-center gap-4 pt-4 border-t border-zinc-800">
                        <div className="flex items-center gap-2 text-sm text-zinc-400">
                            <UtensilsCrossed className="w-4 h-4" />
                            <span>{recentBills.length} meal{recentBills.length !== 1 ? 's' : ''} this month</span>
                        </div>
                        {dataError && <span className="text-xs text-amber-400">{dataError}</span>}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1">
                    <button
                        onClick={() => setActiveTab('bills')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                            activeTab === 'bills' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                    >
                        <Clock className="w-4 h-4" />
                        Recent Bills
                    </button>
                    <button
                        onClick={() => setActiveTab('friends')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                            activeTab === 'friends' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                    >
                        <Users className="w-4 h-4" />
                        Friends
                    </button>
                </div>

                {/* Tab: Recent Bills */}
                {activeTab === 'bills' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {recentBills.length === 0 ? (
                            <div className="py-12 text-center text-zinc-600 col-span-full">
                                <UtensilsCrossed className="w-8 h-8 mx-auto mb-3 opacity-40" />
                                <p className="text-sm">No bills yet.</p>
                                <p className="text-xs mt-1">Host a bill to get started!</p>
                            </div>
                        ) : (
                            recentBills.map(bill => {
                                const isHost = bill.host_id === userId;
                                return (
                                    <div
                                        key={bill.id}
                                        className={`relative rounded-xl transition-all text-left ${
                                            bill.isNew
                                                ? 'bg-emerald-500/5 border border-emerald-500/30 animate-pulse'
                                                : 'bg-zinc-900/60 border border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-600'
                                        }`}
                                    >
                                        <button
                                            onClick={() => router.push(`/bill/${bill.id}`)}
                                            className="w-full flex items-center justify-between p-4 pr-12 text-left"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                                                    bill.isNew ? 'bg-emerald-500/20' : 'bg-zinc-800'
                                                }`}>
                                                    {bill.isNew
                                                        ? <Sparkles className="w-4 h-4 text-emerald-400" />
                                                        : <UtensilsCrossed className="w-4 h-4 text-zinc-500" />
                                                    }
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-zinc-100 text-sm flex items-center gap-2">
                                                        {bill.restaurant_name}
                                                        {bill.isNew && (
                                                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                                New
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                                                        {formatDate(bill.created_at)}
                                                        <span className="text-zinc-700">·</span>
                                                        {isHost ? (
                                                            <span className="text-amber-400 font-medium inline-flex items-center gap-1"><Crown className="w-3 h-3" /> Hosted</span>
                                                        ) : bill.leave_requested ? (
                                                            <span className="text-amber-400 font-medium inline-flex items-center gap-1"><Hourglass className="w-3 h-3" /> Escape Pending</span>
                                                        ) : (
                                                            <span className="text-zinc-500 inline-flex items-center gap-1"><Handshake className="w-3 h-3" /> {bill.host_name || 'Host'}</span>
                                                        )}
                                                        {isHost && (bill.escape_count ?? 0) > 0 && (
                                                            <span className="inline-flex items-center gap-1 text-red-400 font-bold animate-pulse">
                                                                <AlertTriangle className="w-3 h-3" /> {bill.escape_count} Escape{(bill.escape_count ?? 0) > 1 ? 's' : ''}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold font-mono text-emerald-400">₹{bill.my_total.toFixed(2)}</span>
                                            </div>
                                        </button>

                                        {/* 3-dot menu */}
                                        <div className="absolute top-3 right-3">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === bill.id ? null : bill.id); }}
                                                className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </button>
                                            {menuOpenId === bill.id && (
                                                <div className="absolute right-0 top-8 w-44 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-20">
                                                    {isHost ? (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openEditBillName(bill); }}
                                                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
                                                            >
                                                                <Pencil className="w-3.5 h-3.5" /> Edit Bill Name
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteBill(bill.id); }}
                                                                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" /> Delete Room
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRequestLeave(bill.id); }}
                                                            disabled={bill.leave_requested}
                                                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                                                                bill.leave_requested
                                                                    ? 'text-zinc-500 cursor-not-allowed'
                                                                    : 'text-red-400 hover:bg-red-500/10'
                                                            }`}
                                                        >
                                                            <LogOut className="w-3.5 h-3.5" />
                                                            {bill.leave_requested ? 'Escape Pending...' : 'Request to Leave'}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* Tab: Friends */}
                {activeTab === 'friends' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {friends.length === 0 ? (
                            <div className="py-12 text-center text-zinc-600 col-span-full">
                                <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                                <p className="text-sm">No other users yet.</p>
                                <p className="text-xs mt-1">Invite friends to join the app!</p>
                            </div>
                        ) : (
                            friends.map(friend => (
                                <button
                                    key={friend.id}
                                    onClick={() => handleFriendClick(friend)}
                                    className="w-full flex items-center gap-3 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl hover:bg-zinc-800/60 hover:border-zinc-600 transition-all text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center font-bold text-white shrink-0">
                                        {avatarInitial(friend.username)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-zinc-100 truncate">{friend.username}</p>
                                        {friend.vibe ? (
                                            <p className="text-xs text-zinc-500 truncate italic">"{friend.vibe}"</p>
                                        ) : friend.upi_vpa ? (
                                            <p className="text-xs text-zinc-600 truncate font-mono">{friend.upi_vpa}</p>
                                        ) : null}
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* FAB: Host New Bill */}
            <button
                onClick={() => router.push('/host')}
                className="fixed bottom-20 md:bottom-6 right-6 z-30 flex items-center gap-2 px-5 py-4 gradient-emerald rounded-2xl font-bold text-black shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-105 transition-transform"
            >
                <Plus className="w-5 h-5" />
                Host Bill
            </button>

            {/* ── Edit Profile Modal ── */}
            {showEditProfile && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setShowEditProfile(false)}
                >
                    <div
                        className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-3xl overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">Edit Profile</h2>
                            <button
                                onClick={() => setShowEditProfile(false)}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            {editSuccess ? (
                                <div className="text-center py-6 space-y-3">
                                    <div className="flex justify-center"><Lock className="w-10 h-10 text-emerald-400" /></div>
                                    <p className="text-emerald-400 font-bold text-lg">Profile locked in</p>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-2">UPI VPA</label>
                                        <input
                                            type="text"
                                            value={editVpa}
                                            onChange={e => setEditVpa(e.target.value)}
                                            placeholder="yourname@upi"
                                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-2">Your Vibe</label>
                                        <select
                                            value={editVibe}
                                            onChange={e => setEditVibe(e.target.value)}
                                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all appearance-none"
                                        >
                                            <option value="">No vibe selected</option>
                                            <option value="Will pay you back in 3-5 business days">Will pay you back in 3-5 business days</option>
                                            <option value="Professional freeloader">Professional freeloader</option>
                                            <option value="Math ain't mathing">Math ain't mathing</option>
                                            <option value="Here for the vibes, not the bill">Here for the vibes, not the bill</option>
                                            <option value="I only had a Diet Coke">I only had a Diet Coke</option>
                                            <option value="Designated UPI scanner">Designated UPI scanner</option>
                                        </select>
                                    </div>

                                    {/* Emergency Contact (The Snitch) */}
                                    <div className="border-t border-zinc-800 pt-4 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Skull className="w-4 h-4 text-red-400" />
                                            <label className="text-sm font-bold text-red-400">Emergency Contact (The Snitch)</label>
                                        </div>
                                        <p className="text-xs text-zinc-500">If you dodge a bill for 5+ days, the host can message this person on WhatsApp.</p>
                                        <input
                                            type="text"
                                            value={editSnitchName}
                                            onChange={e => setEditSnitchName(e.target.value)}
                                            placeholder="Contact name (e.g. Mom, Roommate)"
                                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                                        />
                                        <input
                                            type="tel"
                                            value={editSnitchPhone}
                                            onChange={e => setEditSnitchPhone(e.target.value)}
                                            placeholder="Phone number (e.g. 9876543210)"
                                            className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                                        />
                                    </div>

                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={editSaving || !editVpa.trim()}
                                        className="w-full py-3 gradient-emerald rounded-xl font-bold text-black flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100"
                                    >
                                        {editSaving ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Save className="w-4 h-4" />
                                                Save Changes
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Friend Profile Modal ── */}
            {selectedFriend && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setSelectedFriend(null)}
                >
                    <div
                        className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-3xl overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="relative p-6 bg-gradient-to-br from-emerald-500/10 to-zinc-900 border-b border-zinc-800">
                            <button
                                onClick={() => setSelectedFriend(null)}
                                className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center font-black text-2xl text-black shadow-lg">
                                    {avatarInitial(selectedFriend.username)}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-white leading-tight">{selectedFriend.username}</h2>
                                    {selectedFriend.vibe && (
                                        <p className="text-sm text-emerald-400 italic mt-0.5">"{selectedFriend.vibe}"</p>
                                    )}
                                    {selectedFriend.upi_vpa && (
                                        <p className="text-xs text-zinc-600 font-mono mt-1">{selectedFriend.upi_vpa}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-5">

                            {sharedSpendLoading ? (
                                <div className="flex items-center gap-3 p-4 bg-zinc-800/40 rounded-2xl">
                                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                                    <span className="text-sm text-zinc-500">Calculating aura...</span>
                                </div>
                            ) : (
                                <>
                                    {/* Aura Score */}
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">Aura Score</p>
                                            <div className="flex items-end gap-1">
                                                <span className={`text-3xl font-black ${getAuraScore() >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {getAuraScore() >= 0 ? '+' : ''}{getAuraScore()}
                                                </span>
                                            </div>
                                            <p className="text-xs text-zinc-600 mt-0.5">{(billsHosted ?? 0)} bills hosted · ₹{(maxItemClaimed ?? 0).toFixed(0)} biggest order</p>
                                        </div>
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${getAuraScore() >= 300 ? 'bg-amber-500/10 border-amber-500/30' : getAuraScore() >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                                            {getAuraScore() >= 300 ? <Crown className="w-6 h-6 text-amber-400" /> : getAuraScore() >= 0 ? <Star className="w-6 h-6 text-emerald-400" /> : <Skull className="w-6 h-6 text-red-400" />}
                                        </div>
                                    </div>

                                    {/* Badges */}
                                    {getAuraBadges().length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {getAuraBadges().map((b, i) => (
                                                <span key={i} className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${b.color}`}>
                                                    <BadgeIcon type={b.iconType} /> {b.label}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Financial Damage */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-amber-400" />
                                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Financial Damage</p>
                                        </div>
                                        <div className="p-4 bg-zinc-800/40 border border-zinc-700/60 rounded-2xl">
                                            <p className="text-xs text-zinc-500 mb-2">Shared meal spend together</p>
                                            <div className="flex items-end gap-1">
                                                <span className="text-zinc-400 text-lg font-bold">₹</span>
                                                <span className="text-4xl font-black text-emerald-400 tracking-tight">
                                                    {(sharedSpend ?? 0).toFixed(0)}
                                                </span>
                                                <span className="text-zinc-500 text-sm mb-1">
                                                    .{((sharedSpend ?? 0) % 1).toFixed(2).slice(2)}
                                                </span>
                                            </div>
                                            {(sharedSpend ?? 0) === 0 && (
                                                <p className="text-xs text-zinc-600 pt-1 inline-flex items-center gap-1">No shared meals yet. Fix that fr fr <Skull className="w-3 h-3" /></p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Crashout Button */}
                                    {(sharedSpend ?? 0) > 0 && (
                                        <button
                                            onClick={() => openCrashout(selectedFriend!)}
                                            className="w-full py-3 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 rounded-xl font-bold text-red-400 text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                            Direct Message
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Bill Name Dialog ── */}
            {editBillId && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setEditBillId(null)}
                >
                    <div
                        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <h3 className="text-base font-bold text-white">Edit Bill Name</h3>
                            <button
                                onClick={() => setEditBillId(null)}
                                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <input
                                type="text"
                                value={editBillName}
                                onChange={e => setEditBillName(e.target.value)}
                                placeholder="Restaurant name"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleSaveBillName()}
                                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setEditBillId(null)}
                                    className="flex-1 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm font-semibold text-zinc-400 hover:bg-zinc-700 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveBillName}
                                    disabled={!editBillName.trim()}
                                    className="flex-1 py-2.5 gradient-emerald rounded-xl text-sm font-bold text-black hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Toast ── */}
            {toast && (
                <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold backdrop-blur-sm shadow-lg animate-pulse">
                    {toast}
                </div>
            )}
        </div>
    );
}
