'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Loader2, Plus, Users, ChevronRight, Zap, X, Flame, AlertTriangle } from 'lucide-react';
import AuraBadge from '@/app/components/AuraBadge';

interface SquadMember {
    user_id: string;
    username: string;
    aura_score: number;
    role: string;
}

interface Squad {
    id: string;
    name: string;
    emoji: string;
    streak_count: number;
    members: SquadMember[];
    created_at: string;
}

interface Friend {
    id: string;
    username: string;
    aura_score: number;
}

export default function SquadsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState('');
    const [squads, setSquads] = useState<Squad[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newEmoji, setNewEmoji] = useState('🍕');
    const [creating, setCreating] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
    const [friends, setFriends] = useState<Friend[]>([]);
    const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
    const [loadingFriends, setLoadingFriends] = useState(false);

    function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    }

    useEffect(() => { loadSquads(); }, []);

    async function loadSquads() {
        const user = await getCurrentUser();
        if (!user) { router.push('/'); return; }
        setUserId(user.id);

        try {
            // Get squad IDs user belongs to
            const { data: memberships, error: memErr } = await supabase
                .from('squad_members')
                .select('squad_id')
                .eq('user_id', user.id);

            if (memErr) {
                console.error('squad_members query failed:', memErr);
                setLoading(false);
                return;
            }

            const squadIds = (memberships || []).map(m => m.squad_id);
            if (squadIds.length === 0) { setLoading(false); return; }

            // Fetch squads
            const { data: squadsData } = await supabase
                .from('squads')
                .select('*')
                .in('id', squadIds);

            // Fetch all members (no FK join — fetch profiles separately)
            const { data: allMembers } = await supabase
                .from('squad_members')
                .select('squad_id, user_id, role')
                .in('squad_id', squadIds);

            // Collect unique user IDs and fetch profiles
            const allUserIds = Array.from(new Set((allMembers || []).map(m => m.user_id)));
            const profileMap = new Map<string, { username: string; aura_score: number }>();
            if (allUserIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('users')
                    .select('id, username, aura_score')
                    .in('id', allUserIds);
                for (const p of (profiles || [])) {
                    profileMap.set(p.id, { username: p.username || 'Unknown', aura_score: p.aura_score ?? 500 });
                }
            }

            // Group members by squad
            const membersBySquad = new Map<string, SquadMember[]>();
            for (const m of (allMembers || [])) {
                const profile = profileMap.get(m.user_id) || { username: 'Unknown', aura_score: 500 };
                const sid = m.squad_id;
                if (!membersBySquad.has(sid)) membersBySquad.set(sid, []);
                membersBySquad.get(sid)!.push({
                    user_id: m.user_id,
                    role: m.role,
                    username: profile.username,
                    aura_score: profile.aura_score,
                });
            }

            const result: Squad[] = (squadsData || []).map(s => ({
                ...s,
                members: membersBySquad.get(s.id) || [],
            }));

            setSquads(result);
        } catch (err) {
            console.error('Failed to load squads:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadFriends(uid: string) {
        setLoadingFriends(true);
        try {
            const { data } = await supabase
                .from('friendships')
                .select('id, user_id_1, user_id_2, status')
                .or(`user_id_1.eq.${uid},user_id_2.eq.${uid}`);

            const accepted = (data || []).filter(f => f.status === 'accepted');
            const friendIds = accepted.map(f => f.user_id_1 === uid ? f.user_id_2 : f.user_id_1);
            if (friendIds.length === 0) { setFriends([]); return; }

            const { data: profiles } = await supabase
                .from('users')
                .select('id, username, aura_score')
                .in('id', friendIds);

            setFriends((profiles || []).map(p => ({
                id: p.id,
                username: p.username || 'Unknown',
                aura_score: p.aura_score ?? 500,
            })));
        } catch (err) {
            console.error('Failed to load friends:', err);
        } finally {
            setLoadingFriends(false);
        }
    }

    function openCreateModal() {
        setShowCreate(true);
        setSelectedFriends(new Set());
        if (userId) loadFriends(userId);
    }

    function toggleFriend(friendId: string) {
        setSelectedFriends(prev => {
            const next = new Set(prev);
            if (next.has(friendId)) next.delete(friendId);
            else next.add(friendId);
            return next;
        });
    }

    async function handleCreate() {
        if (!newName.trim() || !userId) return;
        setCreating(true);
        try {
            // 1. Create the squad
            const { data: squadData, error: squadErr } = await supabase
                .from('squads')
                .insert({ name: newName.trim(), emoji: newEmoji, created_by: userId })
                .select()
                .single();

            if (squadErr) {
                console.error('Squad insert error:', squadErr);
                showToast(`Failed: ${squadErr.message}`, 'err');
                setCreating(false);
                return;
            }

            // 2. Add creator as admin + selected friends as members
            const memberRows = [
                { squad_id: squadData.id, user_id: userId, role: 'admin' },
                ...Array.from(selectedFriends).map(fid => ({ squad_id: squadData.id, user_id: fid, role: 'member' })),
            ];

            const { error: memberErr } = await supabase
                .from('squad_members')
                .insert(memberRows);

            if (memberErr) {
                console.error('Member insert error:', memberErr);
                showToast(`Squad created but failed to add members: ${memberErr.message}`, 'err');
                setCreating(false);
                return;
            }

            // Success
            const addedFriends = friends.filter(f => selectedFriends.has(f.id));
            showToast(`Squad created with ${addedFriends.length + 1} members!`, 'ok');
            setShowCreate(false);
            setNewName('');
            setNewEmoji('🍕');
            setSelectedFriends(new Set());

            // Instant UI update
            setSquads(prev => [...prev, {
                ...squadData,
                members: [
                    { user_id: userId, role: 'admin', username: 'You', aura_score: 500 },
                    ...addedFriends.map(f => ({ user_id: f.id, role: 'member', username: f.username, aura_score: f.aura_score })),
                ],
            }]);
        } catch (err: any) {
            console.error('Create squad error:', err);
            showToast(err?.message || 'Unknown error creating squad', 'err');
        } finally {
            setCreating(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        );
    }

    const EMOJIS = ['🍕', '🔥', '💀', '👑', '⚡', '🎯', '🎰', '💎', '🦈', '🐐'];

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-24">
            <div className="max-w-md md:max-w-2xl mx-auto px-4 pt-10 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Squads</h1>
                        <p className="text-sm text-zinc-500">Your permanent crews</p>
                    </div>
                    <button
                        onClick={openCreateModal}
                        className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-1.5"
                    >
                        <Plus className="w-4 h-4" /> New Squad
                    </button>
                </div>

                {squads.length === 0 ? (
                    <div className="py-16 text-center text-zinc-600">
                        <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p className="text-sm">No squads yet</p>
                        <p className="text-xs mt-1">Create one and add your regular crew</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {squads.map(squad => (
                            <button
                                key={squad.id}
                                onClick={() => router.push(`/squads/${squad.id}`)}
                                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-left hover:bg-zinc-800/60 hover:border-zinc-700 transition-all"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-2xl">{squad.emoji}</span>
                                        <div>
                                            <p className="font-bold text-white">{squad.name}</p>
                                            <p className="text-xs text-zinc-500">{squad.members.length} member{squad.members.length !== 1 ? 's' : ''}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {squad.streak_count > 0 && (
                                            <div className="flex items-center gap-1 text-amber-400">
                                                <Flame className="w-3.5 h-3.5" />
                                                <span className="text-xs font-bold">{squad.streak_count}</span>
                                            </div>
                                        )}
                                        <ChevronRight className="w-5 h-5 text-zinc-600" />
                                    </div>
                                </div>

                                {/* Member avatars */}
                                <div className="flex items-center gap-1.5 mt-3">
                                    {squad.members.slice(0, 5).map(m => (
                                        <div key={m.user_id} className="flex items-center gap-1">
                                            <div className="w-6 h-6 bg-zinc-700 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-300">
                                                {m.username.charAt(0).toUpperCase()}
                                            </div>
                                            <AuraBadge score={m.aura_score} size="sm" />
                                        </div>
                                    ))}
                                    {squad.members.length > 5 && (
                                        <span className="text-xs text-zinc-600">+{squad.members.length - 5}</span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Create Modal */}
                {showCreate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !creating && setShowCreate(false)}>
                        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                                <h3 className="text-base font-bold text-white">Create Squad</h3>
                                <button onClick={() => !creating && setShowCreate(false)} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                    placeholder="Squad name"
                                    maxLength={30}
                                    autoFocus
                                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
                                />
                                <div>
                                    <p className="text-xs text-zinc-500 mb-2">Pick an emoji</p>
                                    <div className="flex flex-wrap gap-2">
                                        {EMOJIS.map(e => (
                                            <button
                                                key={e}
                                                onClick={() => setNewEmoji(e)}
                                                className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                                                    newEmoji === e ? 'bg-emerald-500/20 border-2 border-emerald-500' : 'bg-zinc-800 border border-zinc-700'
                                                }`}
                                            >
                                                {e}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {/* Friend Selector */}
                                <div>
                                    <p className="text-xs text-zinc-500 mb-2">Add friends to squad</p>
                                    {loadingFriends ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                                        </div>
                                    ) : friends.length === 0 ? (
                                        <p className="text-xs text-zinc-600 py-3 text-center">No friends yet. Add friends first!</p>
                                    ) : (
                                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                                            {friends.map(f => (
                                                <button
                                                    key={f.id}
                                                    type="button"
                                                    onClick={() => toggleFriend(f.id)}
                                                    className={`w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left ${
                                                        selectedFriends.has(f.id)
                                                            ? 'bg-emerald-500/15 border border-emerald-500/40'
                                                            : 'bg-zinc-800/50 border border-zinc-700/50 hover:bg-zinc-800'
                                                    }`}
                                                >
                                                    <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                                        selectedFriends.has(f.id)
                                                            ? 'bg-emerald-500 text-black'
                                                            : 'bg-zinc-700 text-zinc-500'
                                                    }`}>
                                                        {selectedFriends.has(f.id) ? '✓' : ''}
                                                    </div>
                                                    <div className="w-6 h-6 bg-zinc-700 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-300 shrink-0">
                                                        {f.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-sm text-zinc-200 truncate">{f.username}</span>
                                                    <AuraBadge score={f.aura_score} size="sm" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {selectedFriends.size > 0 && (
                                        <p className="text-[10px] text-emerald-400 mt-1.5">{selectedFriends.size} friend{selectedFriends.size !== 1 ? 's' : ''} selected</p>
                                    )}
                                </div>

                                <button
                                    onClick={handleCreate}
                                    disabled={creating || !newName.trim()}
                                    className="w-full py-3 gradient-emerald rounded-xl font-bold text-black flex items-center justify-center gap-2 disabled:opacity-50 hover:scale-[1.02] transition-transform"
                                >
                                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                    {creating ? 'Creating...' : 'Create Squad'}
                                </button>
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
