'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Loader2, Users, Crown, TrendingUp, TrendingDown, ArrowRight, Flame, CheckCircle2, UserPlus, LogOut, X, AlertTriangle } from 'lucide-react';
import AuraBadge from '@/app/components/AuraBadge';

interface SquadMember {
    user_id: string;
    username: string;
    aura_score: number;
    role: string;
}

interface LedgerEntry {
    id: string;
    from_user_id: string;
    to_user_id: string;
    amount: number;
    description: string;
    settled: boolean;
    created_at: string;
}

interface Friend {
    id: string;
    username: string;
    aura_score: number;
}

export default function SquadDetailPage() {
    const params = useParams();
    const router = useRouter();
    const squadId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [squad, setSquad] = useState<any>(null);
    const [members, setMembers] = useState<SquadMember[]>([]);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [userId, setUserId] = useState('');
    const [settling, setSettling] = useState<string | null>(null);
    const [showAddMember, setShowAddMember] = useState(false);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [loadingFriends, setLoadingFriends] = useState(false);
    const [addingMember, setAddingMember] = useState<string | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

    function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    }

    useEffect(() => { loadSquad(); }, [squadId]);

    async function loadSquad() {
        const user = await getCurrentUser();
        if (!user) { router.push('/'); return; }
        setUserId(user.id);

        try {
            // Fetch squad info
            const { data: squadData, error: squadErr } = await supabase
                .from('squads')
                .select('*')
                .eq('id', squadId)
                .single();

            if (squadErr || !squadData) {
                console.error('Squad fetch error:', squadErr);
                router.push('/squads');
                return;
            }
            setSquad(squadData);

            // Fetch members (just IDs + roles, no FK join)
            const { data: memberData, error: memberErr } = await supabase
                .from('squad_members')
                .select('user_id, role')
                .eq('squad_id', squadId);

            if (memberErr) {
                console.error('squad_members SELECT error:', memberErr);
            }

            const memberList = memberData || [];
            const memberUserIds = memberList.map(m => m.user_id);

            // Fetch user profiles separately
            let profileMap = new Map<string, { username: string; aura_score: number }>();
            if (memberUserIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('users')
                    .select('id, username, aura_score')
                    .in('id', memberUserIds);
                for (const p of (profiles || [])) {
                    profileMap.set(p.id, { username: p.username || 'Unknown', aura_score: p.aura_score ?? 500 });
                }
            }

            const enrichedMembers: SquadMember[] = memberList.map(m => {
                const profile = profileMap.get(m.user_id) || { username: 'Unknown', aura_score: 500 };
                return {
                    user_id: m.user_id,
                    role: m.role,
                    username: profile.username,
                    aura_score: profile.aura_score,
                };
            });

            // Sort by aura score descending for leaderboard
            enrichedMembers.sort((a, b) => b.aura_score - a.aura_score);
            setMembers(enrichedMembers);

            // Fetch ledger entries (recent, unsettled first)
            const { data: ledgerData } = await supabase
                .from('squad_ledger')
                .select('*')
                .eq('squad_id', squadId)
                .order('created_at', { ascending: false })
                .limit(20);

            setLedger(ledgerData || []);
        } catch (err) {
            console.error('Failed to load squad:', err);
        } finally {
            setLoading(false);
        }
    }

    // Compute net balances from ledger
    function computeBalances(): Map<string, number> {
        const nets = new Map<string, number>();
        for (const m of members) nets.set(m.user_id, 0);

        for (const entry of ledger) {
            if (entry.settled) continue;
            // from_user owes to_user
            nets.set(entry.from_user_id, (nets.get(entry.from_user_id) || 0) - Number(entry.amount));
            nets.set(entry.to_user_id, (nets.get(entry.to_user_id) || 0) + Number(entry.amount));
        }
        return nets;
    }

    async function handleSettle(otherUserId: string) {
        setSettling(otherUserId);
        try {
            // Mark all unsettled entries between these two users as settled
            const { error } = await supabase
                .from('squad_ledger')
                .update({ settled: true })
                .eq('squad_id', squadId)
                .eq('settled', false)
                .or(`and(from_user_id.eq.${userId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${userId})`);

            if (error) {
                console.error('Settle error:', error);
                showToast('Failed to settle', 'err');
            } else {
                showToast('Settled!', 'ok');
                loadSquad();
            }
        } catch (err) {
            console.error('Settle failed:', err);
        } finally {
            setSettling(null);
        }
    }

    async function handleLeave() {
        if (!confirm('Leave this squad?')) return;
        try {
            const { error } = await supabase
                .from('squad_members')
                .delete()
                .eq('squad_id', squadId)
                .eq('user_id', userId);

            if (error) {
                console.error('Leave error:', error);
                showToast('Failed to leave', 'err');
            } else {
                router.push('/squads');
            }
        } catch (err) {
            console.error('Leave failed:', err);
        }
    }

    async function openAddMember() {
        setShowAddMember(true);
        setLoadingFriends(true);
        try {
            const { data } = await supabase
                .from('friendships')
                .select('id, user_id_1, user_id_2, status')
                .or(`user_id_1.eq.${userId},user_id_2.eq.${userId}`);

            const accepted = (data || []).filter(f => f.status === 'accepted');
            const friendIds = accepted.map(f => f.user_id_1 === userId ? f.user_id_2 : f.user_id_1);
            if (friendIds.length === 0) { setFriends([]); return; }

            const { data: profiles } = await supabase
                .from('users')
                .select('id, username, aura_score')
                .in('id', friendIds);

            // Filter out people already in the squad
            const memberIds = new Set(members.map(m => m.user_id));
            setFriends(
                (profiles || [])
                    .filter(p => !memberIds.has(p.id))
                    .map(p => ({
                        id: p.id,
                        username: p.username || 'Unknown',
                        aura_score: p.aura_score ?? 500,
                    }))
            );
        } catch (err) {
            console.error('Failed to load friends:', err);
        } finally {
            setLoadingFriends(false);
        }
    }

    async function handleAddMember(friendId: string) {
        setAddingMember(friendId);
        try {
            const { data, error } = await supabase
                .from('squad_members')
                .insert({ squad_id: squadId, user_id: friendId, role: 'member' })
                .select()
                .single();

            if (error) {
                console.error('Add member error:', error);
                if (error.message.includes('duplicate') || error.code === '23505') {
                    showToast('Already in this squad!', 'err');
                } else {
                    showToast(`Failed: ${error.message}`, 'err');
                }
                return;
            }

            const added = friends.find(f => f.id === friendId);
            showToast(`${added?.username || 'Friend'} added to squad!`, 'ok');

            // Remove from available friends list
            setFriends(prev => prev.filter(f => f.id !== friendId));

            // Add to members list instantly
            if (added) {
                setMembers(prev => [...prev, {
                    user_id: added.id,
                    role: 'member',
                    username: added.username,
                    aura_score: added.aura_score,
                }].sort((a, b) => b.aura_score - a.aura_score));
            }
        } catch (err) {
            console.error('Add member failed:', err);
            showToast('Something went wrong', 'err');
        } finally {
            setAddingMember(null);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        );
    }

    const myRole = members.find(m => m.user_id === userId)?.role;
    const isCreator = squad?.created_by === userId;
    const canAddMembers = isCreator || myRole === 'admin';
    const usernameMap = new Map(members.map(m => [m.user_id, m.username]));
    const balanceMap = computeBalances();

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-24">
            <div className="max-w-md md:max-w-2xl mx-auto px-4 pt-10 space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-4xl">{squad?.emoji}</span>
                        <div>
                            <h1 className="text-2xl font-bold text-white">{squad?.name}</h1>
                            <p className="text-sm text-zinc-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {squad?.streak_count > 0 && (
                            <div className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full">
                                <Flame className="w-4 h-4 text-amber-400" />
                                <span className="text-sm font-bold text-amber-400">{squad.streak_count} week streak</span>
                            </div>
                        )}
                        <button
                            onClick={openAddMember}
                            className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-1.5"
                        >
                            <UserPlus className="w-3.5 h-3.5" /> Add Members
                        </button>
                        <button onClick={handleLeave} className="p-2 text-zinc-500 hover:text-red-400 transition-colors" title="Leave squad">
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Aura Leaderboard */}
                <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Crown className="w-4 h-4 text-amber-400" />
                        <h3 className="text-sm font-bold text-white">Aura Leaderboard</h3>
                    </div>
                    {members.length === 0 ? (
                        <div className="text-center py-8">
                            <Users className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                            <p className="text-sm text-zinc-400 mb-4">No members yet. Add your crew!</p>
                            <button
                                onClick={openAddMember}
                                className="px-5 py-2.5 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/25 transition-all inline-flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" /> Add Members
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {members.map((m, i) => (
                                <div key={m.user_id} className={`flex items-center justify-between p-3 rounded-xl ${
                                    i === 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-zinc-900/40'
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <span className={`text-lg font-black w-6 ${
                                            i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-400' : i === 2 ? 'text-orange-700' : 'text-zinc-600'
                                        }`}>#{i + 1}</span>
                                        <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center text-xs font-bold text-zinc-300">
                                            {m.username.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-sm font-semibold text-zinc-200">{m.username}</span>
                                        {m.user_id === userId && <span className="text-[10px] text-emerald-500 font-bold">(you)</span>}
                                    </div>
                                    <AuraBadge score={m.aura_score} size="md" showLabel />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Squad Vault / Balances */}
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="w-4 h-4 text-blue-400" />
                        <h3 className="text-sm font-bold text-white">Squad Vault</h3>
                    </div>
                    {Array.from(balanceMap.entries()).every(([, v]) => v === 0) ? (
                        <div className="text-center py-6">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                            <p className="text-sm text-zinc-400">All settled! No outstanding debts.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {members.filter(m => m.user_id !== userId && (balanceMap.get(m.user_id) || 0) !== 0).map(m => {
                                const theirBalance = balanceMap.get(m.user_id) || 0;
                                const myBalance = balanceMap.get(userId) || 0;
                                // Positive balance = they're owed money
                                // We show the relationship from my perspective
                                const amount = Math.abs(theirBalance);
                                const theyOweMe = theirBalance < 0;

                                return (
                                    <div key={m.user_id} className="flex items-center justify-between p-3 bg-zinc-800/40 rounded-xl">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center text-xs font-bold text-zinc-300">
                                                {m.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <span className="text-sm font-semibold text-zinc-200">{m.username}</span>
                                                <div className="flex items-center gap-1 text-xs">
                                                    {theyOweMe ? (
                                                        <span className="text-emerald-400 flex items-center gap-0.5">
                                                            <TrendingUp className="w-3 h-3" /> owes you ₹{amount.toFixed(0)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-red-400 flex items-center gap-0.5">
                                                            <TrendingDown className="w-3 h-3" /> you owe ₹{amount.toFixed(0)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleSettle(m.user_id)}
                                            disabled={settling === m.user_id}
                                            className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                                        >
                                            {settling === m.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Settle'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Recent Activity */}
                {ledger.length > 0 && (
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5">
                        <h3 className="text-sm font-bold text-white mb-3">Recent Activity</h3>
                        <div className="space-y-2">
                            {ledger.slice(0, 10).map((entry) => (
                                <div key={entry.id} className={`flex items-center gap-2 text-xs py-1.5 border-b border-zinc-800/50 last:border-0 ${
                                    entry.settled ? 'text-zinc-600 line-through' : 'text-zinc-400'
                                }`}>
                                    <span className="font-semibold text-zinc-300">{usernameMap.get(entry.from_user_id) || '?'}</span>
                                    <ArrowRight className="w-3 h-3 text-zinc-600" />
                                    <span className="font-semibold text-zinc-300">{usernameMap.get(entry.to_user_id) || '?'}</span>
                                    {entry.description && <span className="text-zinc-600 truncate max-w-[100px]">{entry.description}</span>}
                                    <span className="text-emerald-400 font-mono ml-auto">₹{Number(entry.amount).toFixed(0)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Add Member Modal */}
                {showAddMember && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowAddMember(false)}>
                        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                                <h3 className="text-base font-bold text-white">Add Member</h3>
                                <button onClick={() => setShowAddMember(false)} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-5">
                                {loadingFriends ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                                    </div>
                                ) : friends.length === 0 ? (
                                    <p className="text-sm text-zinc-500 text-center py-8">No friends available to add</p>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {friends.map(f => (
                                            <div key={f.id} className="flex items-center justify-between p-2.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 bg-zinc-700 rounded-full flex items-center justify-center text-[10px] font-bold text-zinc-300">
                                                        {f.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-sm text-zinc-200">{f.username}</span>
                                                    <AuraBadge score={f.aura_score} size="sm" />
                                                </div>
                                                <button
                                                    onClick={() => handleAddMember(f.id)}
                                                    disabled={addingMember === f.id}
                                                    className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                                                >
                                                    {addingMember === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast */}
                {toast && (
                    <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-sm px-5 py-3 rounded-xl text-sm font-semibold backdrop-blur-sm shadow-lg flex items-center gap-2 ${
                        toast.type === 'ok'
                            ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                            : 'bg-red-500/20 border border-red-500/40 text-red-300'
                    }`}>
                        {toast.type === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
                        {toast.msg}
                    </div>
                )}
            </div>
        </div>
    );
}
