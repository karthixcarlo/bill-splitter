'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import {
    Search, UserPlus, MessageCircle, Loader2, Users, Check, Clock, X,
    TrendingDown, Crown, Skull,
} from 'lucide-react';
import ChatPanel from '../components/ChatPanel';

interface UserResult {
    id: string;
    username: string;
    upi_vpa: string | null;
    vibe: string | null;
}

interface FriendBadge {
    icon: 'sigma' | 'chad' | 'negative';
    label: string;
    tooltip: string;
    color: string;
}

interface Friendship {
    id: string;
    user_id_1: string;
    user_id_2: string;
    status: string;
    friend: UserResult;
}

export default function FriendsPage() {
    const router = useRouter();
    const [userId, setUserId] = useState('');
    const [loading, setLoading] = useState(true);

    // Search
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserResult[]>([]);
    const [searching, setSearching] = useState(false);

    // Friends list
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [pendingReceived, setPendingReceived] = useState<Friendship[]>([]);
    const [pendingSent, setPendingSent] = useState<Friendship[]>([]);

    // Toast
    const [toast, setToast] = useState('');

    // Desktop split-screen: selected friend for inline chat
    const [activeChatFriend, setActiveChatFriend] = useState<UserResult | null>(null);

    // Mogging badges per friend
    const [friendBadges, setFriendBadges] = useState<Map<string, FriendBadge[]>>(new Map());

    useEffect(() => {
        async function init() {
            const user = await getCurrentUser();
            if (!user) { router.push('/'); return; }
            setUserId(user.id);
            await loadFriendships(user.id);
            setLoading(false);
        }
        init();
    }, []);

    // Compute badges once friends are loaded
    useEffect(() => {
        if (!friends.length) return;
        computeBadges(friends.map(f => f.friend));
    }, [friends]);

    async function computeBadges(friendProfiles: UserResult[]) {
        const ids = friendProfiles.map(f => f.id);
        if (!ids.length) return;

        // Get current month's bills hosted per user
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [{ data: hostedBills }, { data: allClaims }, { data: allPayments }] = await Promise.all([
            supabase.from('bills').select('id, host_id, created_at').in('host_id', ids).gte('created_at', startOfMonth),
            supabase.from('claims').select('user_id, bill_items(bill_id, bills(created_at))').in('user_id', ids),
            supabase.from('payments').select('payer_id, amount_paid, created_at, bills(created_at)').in('payer_id', ids),
        ]);

        // Count bills hosted this month
        const hostedCountMap = new Map<string, number>();
        for (const b of (hostedBills ?? []) as any[]) {
            hostedCountMap.set(b.host_id, (hostedCountMap.get(b.host_id) ?? 0) + 1);
        }

        // Calculate average payment speed per user (time between bill creation and first payment)
        const paymentSpeeds = new Map<string, number[]>();
        for (const p of (allPayments ?? []) as any[]) {
            const billCreated = p.bills?.created_at;
            if (!billCreated || !p.created_at) continue;
            const speed = new Date(p.created_at).getTime() - new Date(billCreated).getTime();
            const existing = paymentSpeeds.get(p.payer_id) ?? [];
            existing.push(speed);
            paymentSpeeds.set(p.payer_id, existing);
        }

        // Calculate unpaid debt per user (claims without corresponding payments older than 7 days)
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        // Simplified: users who have claims on old bills but no payments
        // We'll count total claim volume as a proxy for outstanding debt

        const badgeMap = new Map<string, FriendBadge[]>();

        for (const friend of friendProfiles) {
            const badges: FriendBadge[] = [];

            // The Sigma: avg payment speed < 1 hour
            const speeds = paymentSpeeds.get(friend.id);
            if (speeds && speeds.length > 0) {
                const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
                if (avgSpeed < 60 * 60 * 1000) {
                    badges.push({
                        icon: 'sigma',
                        label: 'Sigma',
                        tooltip: 'Silent, high-efficiency payer.',
                        color: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
                    });
                }
            }

            // The Chad: hosted > 5 bills this month
            const hosted = hostedCountMap.get(friend.id) ?? 0;
            if (hosted > 5) {
                badges.push({
                    icon: 'chad',
                    label: 'Chad',
                    tooltip: 'Mogging the entire room.',
                    color: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
                });
            }

            // Negative Aura: no payments and has claims (simplified heuristic)
            const hasClaims = (allClaims ?? []).some((c: any) => c.user_id === friend.id);
            const hasPayments = (allPayments ?? []).some((p: any) => p.payer_id === friend.id);
            if (hasClaims && !hasPayments) {
                badges.push({
                    icon: 'negative',
                    label: 'Negative Aura',
                    tooltip: 'Professional freeloader.',
                    color: 'text-red-400 border-red-500/40 bg-red-500/10',
                });
            }

            if (badges.length) badgeMap.set(friend.id, badges);
        }

        setFriendBadges(badgeMap);
    }

    async function loadFriendships(uid: string) {
        const { data } = await supabase
            .from('friendships')
            .select('id, user_id_1, user_id_2, status')
            .or(`user_id_1.eq.${uid},user_id_2.eq.${uid}`);

        if (!data?.length) {
            setFriends([]); setPendingReceived([]); setPendingSent([]);
            return;
        }

        // Fetch all friend user profiles
        const friendIds = data.map(f => f.user_id_1 === uid ? f.user_id_2 : f.user_id_1);
        const { data: profiles } = await supabase
            .from('users')
            .select('id, username, upi_vpa, vibe')
            .in('id', friendIds);

        const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

        const enriched = data.map(f => {
            const friendId = f.user_id_1 === uid ? f.user_id_2 : f.user_id_1;
            return { ...f, friend: profileMap.get(friendId) || { id: friendId, username: 'Unknown', upi_vpa: null, vibe: null } };
        }) as Friendship[];

        setFriends(enriched.filter(f => f.status === 'accepted'));
        setPendingReceived(enriched.filter(f => f.status === 'pending' && f.user_id_2 === uid));
        setPendingSent(enriched.filter(f => f.status === 'pending' && f.user_id_1 === uid));
    }

    async function handleSearch(q: string) {
        setQuery(q);
        if (q.trim().length < 2) { setSearchResults([]); return; }
        setSearching(true);
        const { data } = await supabase
            .from('users')
            .select('id, username, upi_vpa, vibe')
            .or(`username.ilike.%${q}%,upi_vpa.ilike.%${q}%`)
            .neq('id', userId)
            .limit(10);
        setSearchResults((data ?? []) as UserResult[]);
        setSearching(false);
    }

    async function sendFriendRequest(friendId: string) {
        const { error } = await supabase.from('friendships').insert({
            user_id_1: userId,
            user_id_2: friendId,
            status: 'pending',
        });
        if (error) {
            if (error.code === '23505') showToast('Friend request already sent');
            else showToast('Failed to send request');
            return;
        }
        showToast('Friend request sent');
        await loadFriendships(userId);
    }

    async function acceptRequest(friendshipId: string) {
        await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
        showToast('Friend request accepted');
        await loadFriendships(userId);
    }

    async function declineRequest(friendshipId: string) {
        await supabase.from('friendships').delete().eq('id', friendshipId);
        showToast('Request declined');
        await loadFriendships(userId);
    }

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    }

    function avatarInitial(name: string) {
        return name?.[0]?.toUpperCase() ?? '?';
    }

    function BadgeIcon({ type }: { type: string }) {
        switch (type) {
            case 'sigma': return <Skull className="w-3 h-3" />;
            case 'chad': return <Crown className="w-3 h-3" />;
            case 'negative': return <TrendingDown className="w-3 h-3" />;
            default: return null;
        }
    }

    function renderBadges(friendId: string) {
        const badges = friendBadges.get(friendId);
        if (!badges?.length) return null;
        return (
            <div className="flex flex-wrap gap-1 mt-0.5">
                {badges.map((b, i) => (
                    <span key={i} title={b.tooltip} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${b.color}`}>
                        <BadgeIcon type={b.icon} /> {b.label}
                    </span>
                ))}
            </div>
        );
    }

    function getFriendshipStatus(targetId: string): string | null {
        const all = [...friends, ...pendingReceived, ...pendingSent];
        const match = all.find(f => f.friend.id === targetId);
        if (!match) return null;
        if (match.status === 'accepted') return 'friends';
        if (match.user_id_1 === userId) return 'sent';
        return 'received';
    }

    function handleMessageClick(friend: UserResult) {
        // On desktop (lg+), open inline chat; on mobile, navigate to full-page chat
        if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
            setActiveChatFriend(friend);
        } else {
            router.push(`/chat/${friend.id}`);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    // Friends list content (shared between mobile and desktop left panel)
    const friendsListContent = (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Friends</h1>
                <p className="text-sm text-zinc-500">Find people, add friends, start chatting</p>
            </div>

            {/* Search Bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                    type="text"
                    value={query}
                    onChange={e => handleSearch(e.target.value)}
                    placeholder="Search by name or UPI..."
                    className="w-full pl-10 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-emerald-500" />}
            </div>

            {/* Search Results */}
            {query.trim().length >= 2 && (
                <div className="space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Search Results</p>
                    {searchResults.length === 0 && !searching ? (
                        <p className="text-sm text-zinc-600 py-4 text-center">No users found</p>
                    ) : (
                        searchResults.map(user => {
                            const status = getFriendshipStatus(user.id);
                            return (
                                <div key={user.id} className="flex items-center gap-3 p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center font-bold text-white shrink-0">
                                        {avatarInitial(user.username)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-zinc-100 truncate">{user.username}</p>
                                        {user.vibe && <p className="text-xs text-zinc-500 truncate italic">"{user.vibe}"</p>}
                                    </div>
                                    {status === 'friends' ? (
                                        <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Friends</span>
                                    ) : status === 'sent' ? (
                                        <span className="text-xs text-zinc-500 font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> Pending</span>
                                    ) : (
                                        <button
                                            onClick={() => sendFriendRequest(user.id)}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" /> Add
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Pending Requests Received */}
            {pendingReceived.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">Friend Requests</p>
                    {pendingReceived.map(req => (
                        <div key={req.id} className="flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-bold text-black shrink-0">
                                {avatarInitial(req.friend.username)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-zinc-100 truncate">{req.friend.username}</p>
                                <p className="text-xs text-zinc-500">wants to be friends</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => acceptRequest(req.id)}
                                    className="p-2 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => declineRequest(req.id)}
                                    className="p-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-400 hover:bg-red-500/30 transition-all"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Friends List */}
            <div className="space-y-2">
                <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">
                    Your Friends ({friends.length})
                </p>
                {friends.length === 0 ? (
                    <div className="py-12 text-center text-zinc-600">
                        <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">No friends yet</p>
                        <p className="text-xs mt-1">Search for people above to add them</p>
                    </div>
                ) : (
                    friends.map(f => (
                        <div
                            key={f.id}
                            className={`flex items-center gap-3 p-3 bg-zinc-900/60 border rounded-xl cursor-pointer transition-all ${
                                activeChatFriend?.id === f.friend.id
                                    ? 'border-emerald-500/40 bg-emerald-500/5'
                                    : 'border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-600'
                            }`}
                            onClick={() => handleMessageClick(f.friend)}
                        >
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center font-bold text-white shrink-0">
                                {avatarInitial(f.friend.username)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-zinc-100 truncate">{f.friend.username}</p>
                                {f.friend.vibe && <p className="text-xs text-zinc-500 truncate italic">"{f.friend.vibe}"</p>}
                                {renderBadges(f.friend.id)}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleMessageClick(f.friend); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all"
                            >
                                <MessageCircle className="w-3.5 h-3.5" /> Message
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-24 lg:pb-0">
            {/* Mobile layout: single column */}
            <div className="lg:hidden max-w-md mx-auto px-4 pt-10">
                {friendsListContent}
            </div>

            {/* Desktop layout: split-screen WhatsApp-Web style */}
            <div className="hidden lg:flex h-screen">
                {/* Left panel: friends list */}
                <div className="w-[380px] shrink-0 border-r border-zinc-800 overflow-y-auto px-4 pt-10 pb-6">
                    {friendsListContent}
                </div>

                {/* Right panel: chat */}
                <div className="flex-1 flex flex-col bg-zinc-950">
                    {activeChatFriend ? (
                        <ChatPanel
                            userId={userId}
                            friendId={activeChatFriend.id}
                            friendName={activeChatFriend.username}
                            friendVibe={activeChatFriend.vibe ?? undefined}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-zinc-600">
                                <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                <p className="text-lg font-semibold text-zinc-500">Select a friend to chat</p>
                                <p className="text-sm mt-1">Pick someone from the list on the left</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold backdrop-blur-sm shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    );
}
