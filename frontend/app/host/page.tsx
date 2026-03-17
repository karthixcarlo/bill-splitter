'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, getCurrentUser, getUserProfile, authHeaders, API_URL } from '@/lib/supabase';
import { Upload, Loader2, Camera, Trash2, Plus, Copy, Check, ExternalLink, Search, UserCheck, Receipt, ChevronRight } from 'lucide-react';

type ViewMode = 'upload' | 'scanning' | 'editor' | 'friends' | 'share';

interface BillItem {
    name: string;
    quantity: number;
    price_per_unit: number;
    total_price: number;
}

interface BillData {
    items: BillItem[];
    tax_amount: number;
    service_charge: number;
    total: number;
    restaurant_name?: string;
}

interface UserProfile {
    id: string;
    username: string;
    upi_vpa: string | null;
    avatar_url: string | null;
}

export default function HostPage() {
    const router = useRouter();
    const [viewMode, setViewMode] = useState<ViewMode>('upload');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string>('');
    const [billData, setBillData] = useState<BillData | null>(null);
    const [shareUrl, setShareUrl] = useState('');
    const [copied, setCopied] = useState(false);

    // Auth & profile state
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [hostProfile, setHostProfile] = useState<any>(null);

    // Friends state
    const [friends, setFriends] = useState<UserProfile[]>([]);
    const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
    const [friendSearch, setFriendSearch] = useState('');

    // AI roast from parse response
    const [aiRoast, setAiRoast] = useState<string | null>(null);

    // Aura threshold
    const [auraThreshold, setAuraThreshold] = useState(0);

    // Recent bills (shown on the upload/default view)
    interface RecentBill { id: string; restaurant_name: string; created_at: string; host_id: string; }
    const [recentBills, setRecentBills] = useState<RecentBill[]>([]);
    const [loadingBills, setLoadingBills] = useState(true);

    // On mount: enforce that the host has a UPI VPA before they can create bills.
    useEffect(() => {
        async function checkOnboarding() {
            const user = await getCurrentUser();
            if (!user) {
                router.push('/onboard');
                return;
            }
            setCurrentUser(user);
            try {
                const profile = await getUserProfile(user.id);
                if (!profile?.upi_vpa) {
                    router.push('/onboard');
                    return;
                }
                setHostProfile(profile);
            } catch {
                router.push('/onboard');
            }
        }
        checkOnboarding();
    }, []);

    // Load recent bills (hosted + joined)
    async function loadRecentBills(uid: string) {
        const [hostedRes, joinedRes] = await Promise.all([
            supabase.from('bills')
                .select('id, restaurant_name, created_at, host_id')
                .eq('host_id', uid)
                .order('created_at', { ascending: false })
                .limit(10),
            supabase.from('participants')
                .select('bill_id, bills(id, restaurant_name, created_at, host_id)')
                .eq('user_id', uid),
        ]);

        const billMap = new Map<string, RecentBill>();
        for (const b of (hostedRes.data ?? []) as any[]) billMap.set(b.id, b);
        for (const row of (joinedRes.data ?? []) as any[]) {
            const b = row.bills;
            if (b && !billMap.has(b.id)) billMap.set(b.id, b);
        }

        const sorted = Array.from(billMap.values())
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 10);

        setRecentBills(sorted);
        setLoadingBills(false);
    }

    useEffect(() => {
        if (currentUser) loadRecentBills(currentUser.id);
    }, [currentUser]);

    // Re-fetch bills on tab focus
    useEffect(() => {
        if (!currentUser) return;
        const onVisible = () => {
            if (document.visibilityState === 'visible') loadRecentBills(currentUser.id);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [currentUser]);

    // Task 2: Load accepted friends (not all users) for the friends picker
    useEffect(() => {
        async function loadFriends() {
            if (!currentUser) return;
            const uid = currentUser.id;

            // Fetch accepted friendships
            const { data: friendships } = await supabase
                .from('friendships')
                .select('user_id_1, user_id_2, status')
                .or(`user_id_1.eq.${uid},user_id_2.eq.${uid}`);

            const accepted = (friendships || []).filter(f => f.status === 'accepted');
            const friendIds = accepted.map(f => f.user_id_1 === uid ? f.user_id_2 : f.user_id_1);
            if (friendIds.length === 0) { setFriends([]); return; }

            // Fetch friend profiles
            const { data: profiles } = await supabase
                .from('users')
                .select('id,username,upi_vpa,avatar_url')
                .in('id', friendIds)
                .order('username');

            setFriends(profiles || []);
        }
        loadFriends();
    }, [currentUser]);

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setPreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    }

    async function handleParseBill() {
        if (!selectedFile) return;
        setViewMode('scanning');
        try {
            const hostId = currentUser?.id ?? '00000000-0000-0000-0000-000000000001';
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('host_id', hostId);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120_000);
            const apiUrl = API_URL;

            const headers = await authHeaders();
            const response = await fetch(`${apiUrl}/api/parse-bill`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
                headers,
            });
            clearTimeout(timeoutId);

            const result = await response.json();
            if (!response.ok) {
                alert(`Parse Error: ${result.detail || `Error ${response.status}`}`);
                setViewMode('upload');
                return;
            }
            if (result.success && result.data) {
                setBillData(result.data);
                if (result.ai_roast) setAiRoast(result.ai_roast);
                setViewMode('editor');
            } else {
                alert('Could not parse bill. Please upload a clear photo of a restaurant receipt.');
                setViewMode('upload');
            }
        } catch (err: any) {
            alert(`Backend unreachable: ${err?.message || 'Unknown error'}. Is the backend running on port 8000?`);
            setViewMode('upload');
        }
    }

    function updateItem(index: number, field: keyof BillItem, value: any) {
        if (!billData) return;
        const newItems = [...billData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        if (field === 'quantity' || field === 'price_per_unit') {
            newItems[index].total_price = newItems[index].quantity * newItems[index].price_per_unit;
        }
        setBillData({ ...billData, items: newItems });
    }

    function deleteItem(index: number) {
        if (!billData) return;
        setBillData({ ...billData, items: billData.items.filter((_, i) => i !== index) });
    }

    function addItem() {
        if (!billData) return;
        setBillData({ ...billData, items: [...billData.items, { name: 'New Item', quantity: 1, price_per_unit: 0, total_price: 0 }] });
    }

    function calculateTotal() {
        if (!billData) return 0;
        return billData.items.reduce((s, i) => s + i.total_price, 0) + billData.tax_amount + billData.service_charge;
    }

    function toggleFriend(id: string) {
        setSelectedFriendIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    // Task 1: Save bill to Supabase (not localStorage)
    async function handleCreatePartyRoom() {
        if (!billData) return;
        setViewMode('scanning');

        try {
            const apiUrl = API_URL;
            const saveHeaders = { 'Content-Type': 'application/json', ...(await authHeaders()) };
            const response = await fetch(`${apiUrl}/api/bills/save`, {
                method: 'POST',
                headers: saveHeaders,
                body: JSON.stringify({
                    host_id: currentUser?.id ?? null,
                    host_vpa: hostProfile?.upi_vpa ?? '',
                    host_name: hostProfile?.username ?? 'Host',
                    restaurant_name: billData.restaurant_name || 'Restaurant',
                    items: billData.items,
                    tax_amount: billData.tax_amount,
                    service_charge: billData.service_charge,
                    total: calculateTotal(),
                    participant_ids: Array.from(selectedFriendIds),
                    ai_roast: aiRoast,
                    min_aura_threshold: auraThreshold,
                }),
            });

            const result = await response.json();
            if (!response.ok || !result.bill_id) {
                throw new Error(result.detail || 'Failed to create room');
            }

            const url = `${window.location.origin}/bill/${result.bill_id}`;
            setShareUrl(url);
            setViewMode('share');
        } catch (err: any) {
            alert('Failed to create party room: ' + (err?.message || 'Unknown error'));
            setViewMode('friends');
        }
    }

    async function copyLink() {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    const filteredFriends = friends.filter(f =>
        f.username.toLowerCase().includes(friendSearch.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6 pb-24 relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none" />

            <div className="max-w-2xl mx-auto space-y-6 pt-8 relative z-10">

                {/* Upload */}
                {viewMode === 'upload' && (
                    <>
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold text-white">Upload Bill</h1>
                            <p className="text-zinc-400">Take a photo or upload an image of your restaurant bill</p>
                        </div>
                        {!preview ? (
                            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-emerald-500 hover:bg-zinc-900/50 transition-all bg-zinc-900/20 backdrop-blur-sm">
                                <Camera className="w-12 h-12 text-zinc-500 mb-3" />
                                <span className="text-zinc-300 mb-1 font-medium">Click to upload bill</span>
                                <span className="text-sm text-zinc-500">JPG, PNG up to 10MB</span>
                                <input type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />
                            </label>
                        ) : (
                            <div className="space-y-4">
                                <img src={preview} alt="Bill Preview" className="w-full rounded-xl border border-zinc-800 shadow-2xl" />
                                <button onClick={handleParseBill} className="w-full py-4 gradient-emerald rounded-xl font-bold text-black text-lg flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02] transition-transform">
                                    <Upload className="w-6 h-6" /> Parse Bill with AI
                                </button>
                                <button onClick={() => { setSelectedFile(null); setPreview(''); }} className="w-full py-3 text-zinc-400 hover:text-white transition-colors">
                                    Choose Different Image
                                </button>
                            </div>
                        )}
                        {/* Recent Bills */}
                        {recentBills.length > 0 && (
                            <div className="mt-8 space-y-3">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-emerald-400" /> Your Recent Bills
                                </h2>
                                <div className="space-y-2">
                                    {recentBills.map(bill => (
                                        <button
                                            key={bill.id}
                                            onClick={() => router.push(`/bill/${bill.id}`)}
                                            className="w-full flex items-center justify-between p-3.5 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:bg-zinc-800/60 hover:border-zinc-700 transition-all text-left"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                                                    <Receipt className="w-3.5 h-3.5 text-zinc-400" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-zinc-200 truncate">{bill.restaurant_name || 'Restaurant'}</p>
                                                    <p className="text-[10px] text-zinc-500">
                                                        {new Date(bill.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                        {bill.host_id === currentUser?.id && <span className="ml-1.5 text-emerald-500">Hosted</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {!loadingBills && recentBills.length === 0 && (
                            <div className="mt-8 text-center py-6">
                                <p className="text-sm text-zinc-500">No bills yet. Upload your first bill above!</p>
                            </div>
                        )}
                    </>
                )}

                {/* Scanning / Saving */}
                {viewMode === 'scanning' && (
                    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin text-emerald-500" />
                        <div className="text-center space-y-2">
                            <h2 className="text-2xl font-bold text-white">Processing...</h2>
                            <p className="text-zinc-400">This usually takes a few seconds</p>
                        </div>
                    </div>
                )}

                {/* Editor */}
                {viewMode === 'editor' && billData && (
                    <>
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold text-white">Verify Bill Items</h1>
                            <p className="text-zinc-400">Review and edit before adding friends</p>
                        </div>

                        <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-2xl overflow-hidden">
                            <div className="bg-zinc-900 p-6 border-b border-zinc-800">
                                <input type="text" value={billData.restaurant_name || ''} onChange={e => setBillData({ ...billData, restaurant_name: e.target.value })}
                                    placeholder="Restaurant Name"
                                    className="text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-emerald-500 outline-none transition-colors w-full font-mono" />
                            </div>

                            <div className="p-6 space-y-3">
                                {billData.items.map((item, idx) => (
                                    <div key={idx} className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
                                        <input type="text" value={item.name} onChange={e => updateItem(idx, 'name', e.target.value)} className="col-span-5 bg-transparent text-zinc-200 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors" />
                                        <input type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)} className="col-span-2 bg-transparent text-zinc-300 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-center" />
                                        <input type="number" value={item.price_per_unit} onChange={e => updateItem(idx, 'price_per_unit', parseFloat(e.target.value) || 0)} className="col-span-2 bg-transparent text-zinc-300 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right" />
                                        <div className="col-span-2 text-right text-emerald-400 font-mono font-semibold text-sm">₹{item.total_price.toFixed(2)}</div>
                                        <button onClick={() => deleteItem(idx)} className="col-span-1 text-red-400 hover:text-red-300 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                ))}
                                <button onClick={addItem} className="w-full py-3 border border-dashed border-zinc-700 rounded-lg text-zinc-400 hover:text-emerald-400 hover:border-emerald-500 transition-colors flex items-center justify-center gap-2">
                                    <Plus className="w-4 h-4" /> Add Item
                                </button>
                            </div>

                            <div className="bg-zinc-900 p-6 border-t border-zinc-800 space-y-3">
                                <div className="flex justify-between text-sm font-mono">
                                    <span className="text-zinc-400">Tax</span>
                                    <input type="number" value={billData.tax_amount} onChange={e => setBillData({ ...billData, tax_amount: parseFloat(e.target.value) || 0 })} className="bg-transparent text-zinc-300 outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right w-24" />
                                </div>
                                <div className="flex justify-between text-sm font-mono">
                                    <span className="text-zinc-400">Service Charge</span>
                                    <input type="number" value={billData.service_charge} onChange={e => setBillData({ ...billData, service_charge: parseFloat(e.target.value) || 0 })} className="bg-transparent text-zinc-300 outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right w-24" />
                                </div>
                                <div className="h-px bg-zinc-700" />
                                <div className="flex justify-between text-xl font-mono font-bold">
                                    <span className="text-white">Total</span>
                                    <span className="text-emerald-400">₹{calculateTotal().toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        <button onClick={() => setViewMode('friends')} className="w-full py-4 gradient-emerald rounded-xl font-bold text-black text-lg shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-transform">
                            Next: Add Friends →
                        </button>
                    </>
                )}

                {/* Friends picker — Task 2 */}
                {viewMode === 'friends' && (
                    <>
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold text-white">Who's at the table?</h1>
                            <p className="text-zinc-400">Select friends to invite. They'll get a notification to claim their items.</p>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <input
                                type="text"
                                placeholder="Search by username..."
                                value={friendSearch}
                                onChange={e => setFriendSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                            />
                        </div>

                        {/* Friends list */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
                            {filteredFriends.length === 0 ? (
                                <div className="p-8 text-center text-zinc-500">
                                    {friends.length === 0
                                        ? 'No other users yet. Share the app with your friends!'
                                        : 'No users match your search'}
                                </div>
                            ) : (
                                filteredFriends.map(friend => {
                                    const selected = selectedFriendIds.has(friend.id);
                                    return (
                                        <button
                                            key={friend.id}
                                            onClick={() => toggleFriend(friend.id)}
                                            className={`w-full flex items-center gap-4 p-4 text-left transition-colors ${selected ? 'bg-emerald-500/10' : 'hover:bg-zinc-800/50'}`}
                                        >
                                            {/* Avatar */}
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${selected ? 'bg-emerald-500 text-black' : 'bg-zinc-700 text-zinc-300'}`}>
                                                {selected ? <UserCheck className="w-5 h-5" /> : friend.username[0]?.toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-semibold truncate ${selected ? 'text-emerald-400' : 'text-zinc-200'}`}>{friend.username}</p>
                                                {friend.upi_vpa && <p className="text-xs text-zinc-500 truncate">{friend.upi_vpa}</p>}
                                            </div>
                                            <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'}`}>
                                                {selected && <Check className="w-3 h-3 text-black" />}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        {selectedFriendIds.size > 0 && (
                            <p className="text-center text-sm text-emerald-400">{selectedFriendIds.size} friend{selectedFriendIds.size !== 1 ? 's' : ''} selected</p>
                        )}

                        {/* Aura Threshold Gate */}
                        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-zinc-300">Min Aura to Join</p>
                                    <p className="text-xs text-zinc-600">Low aura bros get blocked</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min={0}
                                        max={900}
                                        step={50}
                                        value={auraThreshold}
                                        onChange={e => setAuraThreshold(Math.max(0, Math.min(900, Number(e.target.value))))}
                                        className="w-20 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 font-mono text-center focus:outline-none focus:border-emerald-500/50"
                                    />
                                </div>
                            </div>
                            {auraThreshold > 0 && (
                                <p className="text-xs text-amber-400">Only bros with {auraThreshold}+ aura can join this bill</p>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => setViewMode('editor')} className="flex-1 py-4 border border-zinc-700 rounded-xl text-zinc-300 hover:border-zinc-500 transition-colors">
                                ← Back
                            </button>
                            <button onClick={handleCreatePartyRoom} className="flex-2 flex-grow py-4 gradient-emerald rounded-xl font-bold text-black text-lg shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-transform">
                                Create Party Room
                            </button>
                        </div>
                    </>
                )}

                {/* Share screen */}
                {viewMode === 'share' && (
                    <div className="space-y-6">
                        <div className="text-center space-y-2 pt-8">
                            <div className="text-5xl mb-4">🎉</div>
                            <h1 className="text-3xl font-bold text-white">Party Room Created!</h1>
                            <p className="text-zinc-400">Share the link below with your friends.</p>
                        </div>

                        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                            <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Shareable Link</p>
                            <p className="text-sm text-zinc-200 font-mono break-all bg-zinc-950/50 rounded-lg px-3 py-2 border border-zinc-800">{shareUrl}</p>
                            <button onClick={copyLink} className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all ${copied ? 'bg-emerald-600 text-white' : 'gradient-emerald text-black hover:scale-[1.02]'}`}>
                                {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Link</>}
                            </button>
                        </div>

                        <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 space-y-2 text-sm text-zinc-400">
                            <p className="font-medium text-zinc-300">How it works:</p>
                            <ol className="space-y-1 list-decimal list-inside">
                                <li>Share the link with your friends (WhatsApp, iMessage, etc.)</li>
                                <li>They open it, tap the items they ordered</li>
                                <li>They pay you directly via UPI — your VPA is loaded automatically</li>
                            </ol>
                        </div>

                        <button onClick={() => router.push(shareUrl.replace(window.location.origin, ''))} className="w-full py-4 border border-zinc-700 rounded-xl font-bold text-zinc-200 text-lg flex items-center justify-center gap-2 hover:border-emerald-500 hover:text-emerald-400 transition-all">
                            <ExternalLink className="w-5 h-5" /> Open My Room
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
