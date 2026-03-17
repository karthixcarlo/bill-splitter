'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getCurrentUser, authHeaders, API_URL } from '@/lib/supabase';
import { generateUPIIntent, isUPISupported } from '@/lib/upi';
import { calculateUserSubtotal, calculateTaxShare, LocalClaim } from '@/lib/calculations';
import type { BillItem } from '@/lib/calculations';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Users, Share2, CheckCircle, IndianRupee, Copy, X, Minus, Plus, Lock, AlertTriangle, UserCheck, ShieldX, Flame, Scissors, CheckCircle2, XCircle, Hourglass, Pizza, Dices, Skull, Bell, Heart, Mic, Square, Play, Pause, Crown, MessageSquare } from 'lucide-react';
import confetti from 'canvas-confetti';
import AuraBadge from '@/app/components/AuraBadge';

// Generate/restore session ID synchronously so it's available before any useEffect runs
function getOrCreateSessionId(): string {
    if (typeof window === 'undefined') return 'ssr';
    let id = localStorage.getItem('bill_session_id');
    if (!id) {
        id = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('bill_session_id', id);
    }
    return id;
}

interface ClaimEntry { userId: string; username: string }
interface EscapeRequest { user_id: string; username: string; bill_id: string }
interface ParticipantInfo { user_id: string; username: string; aura_score: number; payment_status: string; leave_requested: boolean; mercy_type?: string; mercy_payload?: string; snitch_name?: string; snitch_phone?: string }
interface PaymentRecord { payer_id: string; amount_paid: number }

export default function BillRoom() {
    const params = useParams();
    const router = useRouter();
    const billId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [bill, setBill] = useState<any>(null);
    const [items, setItems] = useState<BillItem[]>([]);
    const [claims, setClaims] = useState<LocalClaim[]>([]);
    const [hostUpi, setHostUpi] = useState('');
    const [showQrModal, setShowQrModal] = useState(false);
    const [qrUpiUrl, setQrUpiUrl] = useState('');

    // Authenticated user info (null for unauthenticated guests)
    const [currentUserId, setCurrentUserId] = useState('');
    const [currentUsername, setCurrentUsername] = useState('');

    // All claims from DB + live Broadcast, keyed by item_id
    // Used to show "Claimed by [name]" lock icon on other users' screens
    const [allClaims, setAllClaims] = useState<Map<string, ClaimEntry[]>>(new Map());

    // Presence / activity
    const [activeViewers, setActiveViewers] = useState(1);
    const [recentActivity, setRecentActivity] = useState(false);

    // Escape requests (host only)
    const [escapeRequests, setEscapeRequests] = useState<EscapeRequest[]>([]);
    const [escapeToast, setEscapeToast] = useState('');

    // AI Roast
    const [aiRoast, setAiRoast] = useState<string | null>(null);

    // Payment audit (Trust Me Bro)
    const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
    const [myPaymentStatus, setMyPaymentStatus] = useState<string>('unpaid');

    // Low Taper Fade (partial payments)
    const [payments, setPayments] = useState<PaymentRecord[]>([]);
    const [showTaperModal, setShowTaperModal] = useState(false);
    const [taperAmount, setTaperAmount] = useState('');
    const [taperSaving, setTaperSaving] = useState(false);
    const [billToast, setBillToast] = useState('');

    // Pizza Slider (fractional claims)
    const [sliderItemId, setSliderItemId] = useState<string | null>(null);
    const [sliderPercent, setSliderPercent] = useState(100);

    // Broke Bro Roulette
    const [showRoulette, setShowRoulette] = useState(false);
    const [rouletteSpinning, setRouletteSpinning] = useState(false);
    const [rouletteLoser, setRouletteLoser] = useState<ParticipantInfo | null>(null);
    const [rouletteHighlight, setRouletteHighlight] = useState(0);

    // Beg for Mercy
    const [showMercyModal, setShowMercyModal] = useState(false);
    const [mercyTab, setMercyTab] = useState<'text' | 'audio'>('text');
    const [mercyText, setMercyText] = useState('');
    const [mercySaving, setMercySaving] = useState(false);
    const [mercyRecording, setMercyRecording] = useState(false);
    const [mercyRecordTime, setMercyRecordTime] = useState(0);
    const mercyRecorderRef = useRef<MediaRecorder | null>(null);
    const mercyChunksRef = useRef<Blob[]>([]);
    const mercyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [mercyAudioUrl, setMercyAudioUrl] = useState<string | null>(null);

    // ── Stable refs ────────────────────────────────────────────────────────────
    // sessionId is initialized synchronously — guaranteed non-empty before channels open
    const sessionId = useRef<string>(getOrCreateSessionId());
    const channelRef = useRef<any>(null);
    const claimsRef = useRef<LocalClaim[]>([]);       // latest claims for Broadcast callbacks
    const usernameRef = useRef<string>('');            // latest username for callbacks
    const currentUserIdRef = useRef<string>('');       // latest userId for callbacks

    useEffect(() => { loadBillData(); }, [billId]);

    // Persist claims to localStorage
    useEffect(() => {
        if (!billId) return;
        localStorage.setItem(`claims_${billId}`, JSON.stringify(claims));
    }, [claims, billId]);

    // Keep refs in sync so Realtime callbacks always read the latest values
    useEffect(() => { claimsRef.current = claims; }, [claims]);

    // Auth guard — redirect unauthenticated users to login with returnTo
    useEffect(() => {
        async function checkAuth() {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                router.push(`/?returnTo=/bill/${billId}`);
                return;
            }
            const user = session.user;
            setCurrentUserId(user.id);
            currentUserIdRef.current = user.id;
            const { data } = await supabase.from('users').select('username').eq('id', user.id).single();
            if (data?.username) {
                setCurrentUsername(data.username);
                usernameRef.current = data.username;
            }
        }
        checkAuth();
    }, [billId]);

    // ─── Supabase Realtime Broadcast + Presence ────────────────────────────────
    // Broadcast (self: false) — ephemeral, no auth, works for guests too.
    // Presence key uses sessionId (stable) so each browser tab is a distinct entry.
    useEffect(() => {
        if (!billId) return;

        const channel = supabase.channel(`bill_claims_${billId}`, {
            config: {
                broadcast: { self: false },
                presence: { key: sessionId.current },   // unique per browser tab
            },
        });
        channelRef.current = channel;

        channel
            .on('broadcast', { event: 'claims_update' }, ({ payload }) => {
                const { sid, username, claims: incoming } = payload as {
                    sid: string; username: string; claims: LocalClaim[];
                };
                if (!sid) return;

                // Rebuild allClaims: remove old entries from this sender, add new ones
                setAllClaims(prev => {
                    const next = new Map(prev);
                    // Clear previous claims from this session
                    next.forEach((entries, itemId) => {
                        const filtered = entries.filter(e => e.userId !== sid);
                        if (filtered.length === 0) next.delete(itemId);
                        else next.set(itemId, filtered);
                    });
                    // Add incoming claims
                    if (incoming?.length) {
                        for (const c of incoming) {
                            const existing = next.get(c.item_id) ?? [];
                            existing.push({ userId: sid, username: username || 'Someone' });
                            next.set(c.item_id, existing);
                        }
                    }
                    return next;
                });

                setRecentActivity(true);
                setTimeout(() => setRecentActivity(false), 1500);
            })
            .on('broadcast', { event: 'roulette_result' }, ({ payload }) => {
                const { loser } = payload as { loser: ParticipantInfo };
                if (loser) {
                    setShowRoulette(true);
                    setRouletteLoser(loser);
                    setRouletteSpinning(false);
                }
            })
            .on('broadcast', { event: 'nudge' }, ({ payload }) => {
                const { targetUserId, message } = payload as { targetUserId: string; message: string };
                if (targetUserId === currentUserIdRef.current) {
                    showBillToast(message);
                }
            })
            .on('broadcast', { event: 'join' }, () => {
                // New viewer joined — re-broadcast our claims so they see current state
                channel.send({
                    type: 'broadcast',
                    event: 'claims_update',
                    payload: {
                        sid: sessionId.current,
                        username: usernameRef.current,
                        claims: claimsRef.current,
                    },
                });
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                setActiveViewers(Math.max(1, Object.keys(state).length));
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.send({ type: 'broadcast', event: 'join', payload: {} });
                    // Track presence with unique key = sessionId (already set at channel config)
                    await channel.track({ user: sessionId.current, t: Date.now() });
                }
            });

        return () => {
            supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [billId]);

    // ─── Supabase Realtime DB Sync (participants + claims) ─────────────────────
    // Refreshes the entire bill state when any participant or claim row changes,
    // so host approvals, "I Paid" clicks, and new claims appear globally without reload.
    useEffect(() => {
        if (!billId) return;
        const syncChannel = supabase
            .channel(`room_sync_${billId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `bill_id=eq.${billId}` }, () => { loadBillData(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, (payload) => {
                // claims table doesn't have bill_id directly — filter by checking if the item belongs to this bill
                loadBillData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `bill_id=eq.${billId}` }, () => { loadBillData(); })
            .subscribe();

        return () => { supabase.removeChannel(syncChannel); };
    }, [billId]);

    // Broadcast own claims whenever they change
    useEffect(() => {
        const ch = channelRef.current;
        if (!ch || !sessionId.current || !billId) return;
        ch.send({
            type: 'broadcast',
            event: 'claims_update',
            payload: { sid: sessionId.current, username: usernameRef.current, claims },
        });
    }, [claims]);

    // ─── Data loading ──────────────────────────────────────────────────────────
    async function loadBillData() {
        try {
            const apiUrl = API_URL;
            const res = await fetch(`${apiUrl}/api/bills/${billId}`);
            if (res.ok) {
                const data = await res.json();
                setBill(data);
                setItems(data.items || []);
                if (data.host_vpa) setHostUpi(data.host_vpa);
                if (data.ai_roast) setAiRoast(data.ai_roast);
                if (data.participants) setParticipants(data.participants);
                if (data.payments) setPayments(data.payments);

                // Set current user's payment status (+ confetti if just cleared)
                if (data.participants && currentUserIdRef.current) {
                    const me = data.participants.find((p: any) => p.user_id === currentUserIdRef.current);
                    if (me) {
                        const newStatus = me.payment_status || 'unpaid';
                        setMyPaymentStatus(prev => {
                            if (prev === 'pending_audit' && newStatus === 'cleared') {
                                fireConfetti();
                                showBillToast('Your payment has been verified!');
                            }
                            return newStatus;
                        });
                    }
                }

                // Seed escape requests from API response
                if (data.escape_requests?.length) {
                    setEscapeRequests(data.escape_requests);
                }

                // Seed allClaims from DB — gives us real usernames for sessions that just opened
                // Exclude current user's own claims (they show via `claims` local state instead)
                if (data.claims?.length) {
                    const claimMap = new Map<string, ClaimEntry[]>();
                    for (const c of data.claims) {
                        if (c.user_id === currentUserIdRef.current) continue;
                        const existing = claimMap.get(c.item_id) ?? [];
                        existing.push({ userId: c.user_id, username: c.username || 'Someone' });
                        claimMap.set(c.item_id, existing);
                    }
                    setAllClaims(claimMap);
                }

                restoreClaims();
                setLoading(false);
                return;
            }

            // Fallback: old bills stored in localStorage
            const localData = localStorage.getItem(`bill_${billId}`);
            if (localData) {
                const parsed = JSON.parse(localData);
                setBill(parsed);
                setItems(parsed.items || []);
                restoreClaims();
                setLoading(false);
                return;
            }

            alert('Bill not found. Make sure you have the right link.');
            router.push('/');
        } catch (err) {
            console.error('Error loading bill:', err);
            alert('Could not load bill. Is the backend running?');
            router.push('/');
        } finally {
            setLoading(false);
        }
    }

    function restoreClaims() {
        const saved = localStorage.getItem(`claims_${billId}`);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        // Migrate old format (array of id strings) to LocalClaim[]
        if (typeof parsed[0] === 'string') {
            setClaims(parsed.map((id: string) => ({ item_id: id, qty_claimed: 1 })));
        } else {
            setClaims(parsed);
        }
    }

    // ─── Escape requests (host only) ───────────────────────────────────────────
    async function loadEscapeRequests() {
        if (!billId || !currentUserId) return;
        // Only the host needs to see these
        const { data: participants } = await supabase
            .from('participants')
            .select('user_id, bill_id, leave_requested, users(username)')
            .eq('bill_id', billId)
            .eq('leave_requested', true);
        if (participants?.length) {
            setEscapeRequests(
                (participants as any[]).map(p => ({
                    user_id: p.user_id,
                    username: p.users?.username || 'Someone',
                    bill_id: p.bill_id,
                }))
            );
        } else {
            setEscapeRequests([]);
        }
    }

    // Poll escape requests when host views the bill
    useEffect(() => {
        if (!bill || !currentUserId || bill.host_id !== currentUserId) return;
        loadEscapeRequests();
        // Also listen for real-time participant updates
        const channel = supabase
            .channel(`escape_requests_${billId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'participants', filter: `bill_id=eq.${billId}` },
                () => { loadEscapeRequests(); }
            )
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [bill, currentUserId, billId]);

    async function handleApproveLeave(req: EscapeRequest) {
        try {
            const { error } = await supabase
                .from('participants')
                .delete()
                .match({ bill_id: req.bill_id, user_id: req.user_id });
            if (error) throw error;
            setEscapeRequests(prev => prev.filter(r => r.user_id !== req.user_id));
            setEscapeToast(`${req.username} has been released`);
            setTimeout(() => setEscapeToast(''), 3000);
        } catch (err) {
            console.error('[bill] approve leave failed:', err);
            alert('Failed to approve leave');
        }
    }

    async function handleDenyLeave(req: EscapeRequest) {
        try {
            const { error } = await supabase
                .from('participants')
                .update({ leave_requested: false })
                .match({ bill_id: req.bill_id, user_id: req.user_id });
            if (error) throw error;
            setEscapeRequests(prev => prev.filter(r => r.user_id !== req.user_id));
            setEscapeToast('Escape denied. They stay locked in.');
            setTimeout(() => setEscapeToast(''), 3000);
        } catch (err) {
            console.error('[bill] deny leave failed:', err);
            alert('Failed to deny leave');
        }
    }

    // ─── Claim helpers ────────────────────────────────────────────────────────
    function getClaimQty(itemId: string): number {
        return claims.find(c => c.item_id === itemId)?.qty_claimed ?? 0;
    }

    // Returns ClaimEntry[] for OTHER users (excludes self by userId OR sessionId)
    function getOtherClaimers(itemId: string): ClaimEntry[] {
        return (allClaims.get(itemId) ?? []).filter(
            e => e.userId !== currentUserId && e.userId !== sessionId.current
        );
    }

    async function handleItemClick(item: BillItem) {
        if (isHost) return; // Host cannot claim items on their own bill
        const qty = getClaimQty(item.id);
        if (qty > 0 && item.quantity > 1) return; // stepper handles multi-qty

        if (qty > 0) {
            // Unclaim — also close slider if open for this item
            if (sliderItemId === item.id) setSliderItemId(null);
            setClaims(prev => prev.filter(c => c.item_id !== item.id));
            if (currentUserId) {
                supabase.from('claims')
                    .delete()
                    .eq('item_id', item.id)
                    .eq('user_id', currentUserId)
                    .then(() => {});
            }
        } else {
            // For single-qty items, open the pizza slider
            if (item.quantity === 1) {
                setSliderPercent(100);
                setSliderItemId(item.id);
            } else {
                // Multi-qty: claim 1 unit at full fraction (existing behaviour)
                setClaims(prev => [...prev, { item_id: item.id, qty_claimed: 1 }]);
                if (currentUserId) {
                    supabase.from('claims')
                        .insert({ item_id: item.id, user_id: currentUserId })
                        .then(() => {});
                }
            }
        }
    }

    function confirmPizzaSlider(itemId: string) {
        const fraction = sliderPercent / 100;
        setClaims(prev => [...prev, { item_id: itemId, qty_claimed: 1, share_fraction: fraction }]);
        if (currentUserId) {
            supabase.from('claims')
                .insert({ item_id: itemId, user_id: currentUserId, share_fraction: fraction })
                .then(() => {});
        }
        setSliderItemId(null);
    }

    function adjustQty(item: BillItem, delta: number, e: React.MouseEvent) {
        e.stopPropagation();
        if (isHost) return; // Host cannot claim items
        const current = getClaimQty(item.id);
        const next = current + delta;
        const otherCount = getOtherClaimers(item.id).length;
        const myMax = item.quantity - otherCount;
        if (next <= 0) {
            setClaims(prev => prev.filter(c => c.item_id !== item.id));
            if (currentUserId) {
                supabase.from('claims').delete()
                    .eq('item_id', item.id).eq('user_id', currentUserId).then(() => {});
            }
        } else if (next <= myMax) {
            setClaims(prev =>
                prev.map(c => c.item_id === item.id ? { ...c, qty_claimed: next } : c)
            );
        }
    }

    // ─── Payment Audit (Trust Me Bro) ──────────────────────────────────────────
    async function handleMarkPaid() {
        if (!currentUserId || !billId) return;
        const { error } = await supabase
            .from('participants')
            .update({ payment_status: 'pending_audit' })
            .match({ bill_id: billId, user_id: currentUserId });
        if (!error) {
            setMyPaymentStatus('pending_audit');
            showBillToast('Payment marked as sent. Waiting for Host to verify.');
        }
    }

    async function handleAuditDecision(userId: string, decision: 'cleared' | 'unpaid') {
        const { error } = await supabase
            .from('participants')
            .update({ payment_status: decision })
            .match({ bill_id: billId, user_id: userId });
        if (!error) {
            setParticipants(prev => prev.map(p =>
                p.user_id === userId ? { ...p, payment_status: decision } : p
            ));
            if (decision === 'cleared') {
                fireConfetti();
                showBillToast('Money secured');
                recordAura(userId, 'payment_cleared');
            } else {
                showBillToast('Payment rejected');
            }
        }
    }

    // ─── Low Taper Fade (partial payments) ──────────────────────────────────────
    async function handleTaperFade() {
        const amount = parseFloat(taperAmount);
        if (!amount || amount <= 0 || !currentUserId || !bill?.host_id) return;
        setTaperSaving(true);
        const { error } = await supabase.from('payments').insert({
            payer_id: currentUserId,
            receiver_id: bill.host_id,
            bill_id: billId,
            amount_paid: amount,
        });
        if (!error) {
            setPayments(prev => [...prev, { payer_id: currentUserId, amount_paid: amount }]);
            const remaining = myTotal - myTotalPaid - amount;
            showBillToast(`Massive W. You gave your debt a low taper fade. ₹${Math.max(0, remaining).toFixed(0)} remaining.`);
            setShowTaperModal(false);
            setTaperAmount('');
        }
        setTaperSaving(false);
    }

    function showBillToast(msg: string) {
        setBillToast(msg);
        setTimeout(() => setBillToast(''), 4000);
    }

    async function recordAura(targetUserId: string, eventType: string) {
        try {
            const apiUrl = API_URL;
            const headers = await authHeaders();
            await fetch(`${apiUrl}/api/aura/record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ target_user_id: targetUserId, event_type: eventType, bill_id: billId }),
            });
        } catch { /* non-fatal */ }
    }

    // ─── Confetti helper ────────────────────────────────────────────────────────
    function fireConfetti() {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#22c55e', '#16a34a', '#ffffff', '#10b981'] });
        setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.7 }, colors: ['#fbbf24', '#f59e0b'] }), 300);
    }

    // ─── Nudge (Weaponized Push) ────────────────────────────────────────────────
    const [nudgeCooldown, setNudgeCooldown] = useState<Set<string>>(new Set());

    async function nudgeParticipant(targetUserId: string, targetUsername: string) {
        if (nudgeCooldown.has(targetUserId)) return;
        const roasts = [
            `${targetUsername}, pay up or lose all aura forever`,
            `${targetUsername} is still dodging payment like it's cardio`,
            `Bro ${targetUsername} really thought we'd forget`,
            `${targetUsername}, your wallet called — it wants to be used`,
            `Everyone stare at ${targetUsername} until they pay`,
        ];
        const msg = roasts[Math.floor(Math.random() * roasts.length)];

        await supabase.from('notifications').insert({
            user_id: targetUserId,
            from_user_id: currentUserId,
            bill_id: billId,
            type: 'nudge',
            message: msg,
        });

        // Broadcast nudge via Realtime so it's instant
        channelRef.current?.send({
            type: 'broadcast',
            event: 'nudge',
            payload: { targetUserId, message: msg },
        });

        setNudgeCooldown(prev => new Set(prev).add(targetUserId));
        recordAura(targetUserId, 'nudge_received');
        showBillToast(`Nudge sent to ${targetUsername}`);
        setTimeout(() => {
            setNudgeCooldown(prev => {
                const next = new Set(prev);
                next.delete(targetUserId);
                return next;
            });
        }, 30000); // 30s cooldown per person
    }

    // ─── Beg for Mercy (micro-debt forgiveness) ─────────────────────────────────
    async function startMercyRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mercyChunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) mercyChunksRef.current.push(e.data); };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(mercyChunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setMercyAudioUrl(url);
            };
            recorder.start();
            mercyRecorderRef.current = recorder;
            setMercyRecording(true);
            setMercyRecordTime(0);
            setMercyAudioUrl(null);
            mercyTimerRef.current = setInterval(() => setMercyRecordTime(t => t + 1), 1000);
        } catch {
            alert('Microphone access denied');
        }
    }

    function stopMercyRecording() {
        if (mercyTimerRef.current) { clearInterval(mercyTimerRef.current); mercyTimerRef.current = null; }
        mercyRecorderRef.current?.stop();
        setMercyRecording(false);
    }

    async function submitMercy() {
        if (!currentUserId || !billId) return;
        setMercySaving(true);

        let mercyType: 'text' | 'audio' = mercyTab;
        let payload = '';

        if (mercyTab === 'text') {
            const wordCount = mercyText.trim().split(/\s+/).filter(Boolean).length;
            if (wordCount < 50) {
                alert(`Your apology needs at least 50 words. You wrote ${wordCount}. Beg harder.`);
                setMercySaving(false);
                return;
            }
            payload = mercyText.trim();
        } else {
            // Upload audio to Supabase Storage
            if (!mercyChunksRef.current.length) {
                alert('Record at least 5 seconds of begging.');
                setMercySaving(false);
                return;
            }
            if (mercyRecordTime < 5) {
                alert('Record at least 5 seconds. Your begging was too short.');
                setMercySaving(false);
                return;
            }
            const blob = new Blob(mercyChunksRef.current, { type: 'audio/webm' });
            const filename = `mercy_${currentUserId}_${Date.now()}.webm`;
            const { error: uploadError } = await supabase.storage
                .from('voice_notes')
                .upload(filename, blob, { contentType: 'audio/webm' });
            if (uploadError) {
                alert('Failed to upload voice note. Try again.');
                setMercySaving(false);
                return;
            }
            const { data: urlData } = supabase.storage.from('voice_notes').getPublicUrl(filename);
            payload = urlData?.publicUrl || '';
            if (!payload) {
                setMercySaving(false);
                return;
            }
        }

        // Update participant row
        const { error } = await supabase
            .from('participants')
            .update({ payment_status: 'pending_mercy', mercy_type: mercyType, mercy_payload: payload })
            .match({ bill_id: billId, user_id: currentUserId });

        if (!error) {
            setMyPaymentStatus('pending_mercy');
            setShowMercyModal(false);
            showBillToast('Mercy requested. Pray the Host accepts.');
        }
        setMercySaving(false);
    }

    async function handleMercyDecision(userId: string, decision: 'grant' | 'deny') {
        const newStatus = decision === 'grant' ? 'cleared' : 'unpaid';
        const { error } = await supabase
            .from('participants')
            .update({
                payment_status: newStatus,
                ...(decision === 'deny' ? { mercy_type: 'none', mercy_payload: null } : {}),
            })
            .match({ bill_id: billId, user_id: userId });

        if (!error) {
            setParticipants(prev => prev.map(p =>
                p.user_id === userId ? { ...p, payment_status: newStatus, ...(decision === 'deny' ? { mercy_type: 'none', mercy_payload: undefined } : {}) } : p
            ));
            if (decision === 'grant') {
                fireConfetti();
                showBillToast('Mercy granted. Debt forgiven.');
                recordAura(userId, 'mercy_granted');
            } else {
                showBillToast('Mercy denied. They must pay.');
            }
        }
    }

    // ─── Deploy Snitch (WhatsApp escalation) ─────────────────────────────────────
    function deploySnitch(participant: ParticipantInfo) {
        if (!participant.snitch_phone || !participant.snitch_name) {
            showBillToast(`${participant.username} has no emergency contact on file.`);
            return;
        }

        const daysSinceBill = bill?.created_at
            ? Math.floor((Date.now() - new Date(bill.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : 0;

        // Calculate this participant's debt amount from claims
        const participantClaims = (bill?.claims || []).filter((c: any) => c.user_id === participant.user_id);
        const pSubtotal = participantClaims.reduce((sum: number, c: any) => {
            const item = items.find(i => i.id === c.item_id);
            if (!item) return sum;
            return sum + item.price_per_unit * (c.share_fraction || 1.0);
        }, 0);
        const pTaxShare = calculateTaxShare(pSubtotal, billTotal, bill?.tax_amount || 0, bill?.service_charge || 0);
        const pTotal = pSubtotal + pTaxShare;
        const pPaid = payments.filter(p => p.payer_id === participant.user_id).reduce((s, p) => s + p.amount_paid, 0);
        const pOwes = Math.max(0, pTotal - pPaid);

        const phone = participant.snitch_phone.replace(/[^0-9]/g, '');
        const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;
        const message = `🚨 Hey ${participant.snitch_name}, your friend ${participant.username} has been dodging a ₹${Math.ceil(pOwes)} bill at ${bill?.restaurant_name || 'a restaurant'} for ${daysSinceBill} days on our app. Tell them to pay up so their Aura doesn't drop to zero.`;
        const url = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
        showBillToast(`Snitch deployed on ${participant.username}`);
        recordAura(participant.user_id, 'snitch_deployed');
    }

    // ─── Broke Bro Roulette ─────────────────────────────────────────────────────
    async function startRoulette() {
        if (participants.length < 2) { showBillToast('Need at least 2 participants for roulette!'); return; }
        setShowRoulette(true);
        setRouletteLoser(null);
        setRouletteSpinning(true);

        // Animate: rapidly cycle through participants for 3.5 seconds
        const eligible = participants.filter(p => p.user_id !== bill?.host_id);
        if (eligible.length === 0) { setRouletteSpinning(false); return; }

        let idx = 0;
        const interval = setInterval(() => {
            idx = (idx + 1) % eligible.length;
            setRouletteHighlight(idx);
        }, 100);

        // Slow down over time
        setTimeout(() => clearInterval(interval), 2500);
        const slowInterval = setTimeout(() => {
            let slowIdx = idx;
            const slow = setInterval(() => {
                slowIdx = (slowIdx + 1) % eligible.length;
                setRouletteHighlight(slowIdx);
            }, 300);
            setTimeout(() => {
                clearInterval(slow);
                // Pick the loser
                const loserIdx = Math.floor(Math.random() * eligible.length);
                setRouletteHighlight(loserIdx);
                setRouletteLoser(eligible[loserIdx]);
                setRouletteSpinning(false);
                recordAura(eligible[loserIdx].user_id, 'roulette_loser');

                // Broadcast roulette result via Realtime
                channelRef.current?.send({
                    type: 'broadcast',
                    event: 'roulette_result',
                    payload: { loser: eligible[loserIdx] },
                });
            }, 1200);
        }, 2500);
    }

    // ─── Math ─────────────────────────────────────────────────────────────────
    const billTotal = bill?.total || items.reduce((s, i) => s + i.total_price, 0);
    const mySubtotal = calculateUserSubtotal(items, claims);
    const taxShare = calculateTaxShare(mySubtotal, billTotal, bill?.tax_amount || 0, bill?.service_charge || 0);
    const myTotal = mySubtotal + taxShare;
    const totalClaimedItems = claims.reduce((s, c) => s + c.qty_claimed, 0);
    const myTotalPaid = payments
        .filter(p => p.payer_id === currentUserId)
        .reduce((s, p) => s + p.amount_paid, 0);
    const myRemaining = Math.max(0, myTotal - myTotalPaid);
    const pendingAudits = participants.filter(p => p.payment_status === 'pending_audit' && p.user_id !== bill?.host_id);
    const pendingMercies = participants.filter(p => p.payment_status === 'pending_mercy' && p.user_id !== bill?.host_id);
    const isHost = bill?.host_id === currentUserId;
    const canBegForMercy = !isHost && myRemaining > 0 && myRemaining <= 50 && myPaymentStatus === 'unpaid';
    const billAgeDays = bill?.created_at ? Math.floor((Date.now() - new Date(bill.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;

    // ─── Share / UPI helpers ──────────────────────────────────────────────────
    async function handleShare() {
        const url = `${window.location.origin}/bill/${billId}`;
        if (navigator.share) {
            await navigator.share({ title: 'Join Bill Split', url });
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            alert('Link copied! Share it with your friends.');
        } else {
            prompt('Copy this link and share it:', url);
        }
    }

    const isMobile = isUPISupported();
    const upiUrl = hostUpi && myTotal > 0
        ? generateUPIIntent(hostUpi, bill?.host_name || 'Host', myTotal, `Bill split - ${bill?.restaurant_name || 'Restaurant'}`)
        : '';

    function handlePayDesktop() {
        if (myTotal === 0) { alert('Please select at least one item first!'); return; }
        if (!hostUpi) { alert('Host payment details not available. Ask the host to complete their UPI setup.'); return; }
        setQrUpiUrl(upiUrl);
        setShowQrModal(true);
    }

    function handleMobilePayClick(e: React.MouseEvent<HTMLAnchorElement>) {
        if (myTotal === 0) { e.preventDefault(); alert('Please select at least one item first!'); return; }
        if (!hostUpi) { e.preventDefault(); alert('Host payment details not available. Ask the host to complete their UPI setup.'); return; }
    }

    // ─── Render ───────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    // Aura threshold gate — if bill requires minimum aura and user doesn't meet it
    const minAura = bill?.min_aura_threshold ?? 0;
    const myAura = participants.find(p => p.user_id === currentUserId)?.aura_score ?? 500;
    if (minAura > 0 && !isHost && myAura < minAura) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
                <div className="max-w-sm text-center space-y-4">
                    <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
                        <Lock className="w-10 h-10 text-red-400" />
                    </div>
                    <h2 className="text-2xl font-black text-white">Aura Check Failed</h2>
                    <p className="text-zinc-400">
                        This bill requires a minimum aura of <span className="text-red-400 font-bold">{minAura}</span>.
                        Your aura is <AuraBadge score={myAura} size="md" showLabel />.
                    </p>
                    <p className="text-sm text-zinc-600">Pay your debts faster to raise your aura score.</p>
                    <button onClick={() => router.push('/home')} className="px-6 py-3 bg-zinc-800 border border-zinc-700 rounded-xl font-bold text-zinc-300 hover:bg-zinc-700 transition-all">
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 pb-48 relative overflow-hidden">
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
                            {totalClaimedItems} item{totalClaimedItems !== 1 ? 's' : ''} claimed
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Live presence badge */}
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-all duration-300 ${
                            recentActivity
                                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 scale-105'
                                : 'bg-zinc-800/80 border-zinc-700 text-zinc-400'
                        }`}>
                            <span className={`w-2 h-2 rounded-full ${
                                recentActivity
                                    ? 'bg-emerald-400 animate-ping'
                                    : activeViewers > 1
                                        ? 'bg-emerald-500 animate-pulse'
                                        : 'bg-zinc-600'
                            }`} />
                            {activeViewers > 1
                                ? `${activeViewers} bros locked in`
                                : 'waiting for bros...'
                            }
                        </div>
                        <button
                            onClick={handleShare}
                            className="p-3 bg-zinc-800/80 rounded-lg hover:bg-emerald-500 hover:text-black transition-all"
                        >
                            <Share2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            {/* AI Roast */}
            {aiRoast && (
                <div className="max-w-md mx-auto px-4 pt-4 relative z-10">
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-orange-500/20 rounded-lg shrink-0">
                                <Flame className="w-5 h-5 text-orange-400" />
                            </div>
                            <div>
                                <p className="text-xs text-orange-400 font-bold uppercase tracking-widest mb-1">AI Roast</p>
                                <p className="text-sm text-orange-200 leading-relaxed">{aiRoast}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Broke Bro Roulette Button (Host only) */}
            {isHost && participants.length >= 2 && (
                <div className="max-w-md mx-auto px-4 pt-3 relative z-10">
                    <button
                        onClick={() => { setRouletteLoser(null); setShowRoulette(true); }}
                        className="w-full py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm font-bold text-red-400 hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                    >
                        <Dices className="w-4 h-4" /> Broke Bro Roulette
                    </button>
                </div>
            )}

            {/* Payment Audits (Host only — Trust Me Bro) */}
            {isHost && pendingAudits.length > 0 && (
                <div className="max-w-md mx-auto px-4 pt-3 relative z-10">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            Payment Audits
                        </div>
                        {pendingAudits.map(p => (
                            <div key={p.user_id} className="flex items-center justify-between gap-2 bg-zinc-900/60 rounded-lg p-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-zinc-200">{p.username}</span>
                                    <AuraBadge score={p.aura_score ?? 500} />
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleAuditDecision(p.user_id, 'cleared')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Money Secured
                                    </button>
                                    <button
                                        onClick={() => handleAuditDecision(p.user_id, 'unpaid')}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-lg text-xs font-bold text-red-400 hover:bg-red-500/30 transition-all"
                                    >
                                        <XCircle className="w-3.5 h-3.5" /> Cap
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Mercy Petitions (Host only — Beg for Mercy) */}
            {isHost && pendingMercies.length > 0 && (
                <div className="max-w-md mx-auto px-4 pt-3 relative z-10">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                            <Heart className="w-4 h-4" />
                            Mercy Petitions
                        </div>
                        {pendingMercies.map(p => (
                            <div key={p.user_id} className="bg-zinc-900/60 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-zinc-200">{p.username}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-bold uppercase">
                                            {p.mercy_type === 'audio' ? 'Voice' : 'Text'}
                                        </span>
                                    </div>
                                </div>
                                {/* Show mercy payload */}
                                {p.mercy_type === 'text' && p.mercy_payload && (
                                    <div className="bg-zinc-800/60 rounded-lg p-3 max-h-32 overflow-y-auto">
                                        <p className="text-xs text-zinc-300 whitespace-pre-wrap italic">"{p.mercy_payload}"</p>
                                    </div>
                                )}
                                {p.mercy_type === 'audio' && p.mercy_payload && (
                                    <div className="bg-zinc-800/60 rounded-lg p-3">
                                        <audio controls className="w-full h-8" src={p.mercy_payload} preload="metadata" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleMercyDecision(p.user_id, 'grant')}
                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                    >
                                        <Crown className="w-3.5 h-3.5" /> Grant Mercy
                                    </button>
                                    <button
                                        onClick={() => handleMercyDecision(p.user_id, 'deny')}
                                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-lg text-xs font-bold text-red-400 hover:bg-red-500/30 transition-all"
                                    >
                                        <XCircle className="w-3.5 h-3.5" /> Deny
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Nudge Unpaid Bros (Host only) */}
            {isHost && participants.filter(p => p.user_id !== bill?.host_id && p.payment_status === 'unpaid').length > 0 && (
                <div className="max-w-md mx-auto px-4 pt-3 relative z-10">
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2 text-zinc-400 font-bold text-xs uppercase tracking-widest">
                            <Bell className="w-3.5 h-3.5" />
                            Unpaid Bros
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {participants
                                .filter(p => p.user_id !== bill?.host_id && p.payment_status === 'unpaid')
                                .map(p => (
                                    <div key={p.user_id} className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => nudgeParticipant(p.user_id, p.username)}
                                            disabled={nudgeCooldown.has(p.user_id)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                                nudgeCooldown.has(p.user_id)
                                                    ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                                                    : 'bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20'
                                            }`}
                                        >
                                            <Bell className="w-3 h-3" />
                                            {nudgeCooldown.has(p.user_id) ? 'Sent' : `Nudge ${p.username}`}
                                        </button>
                                        {billAgeDays >= 5 && p.snitch_phone && (
                                            <button
                                                onClick={() => deploySnitch(p)}
                                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 bg-red-600/20 border border-red-600/40 text-red-400 hover:bg-red-600/30 transition-all"
                                                title={`Message ${p.snitch_name} on WhatsApp`}
                                            >
                                                <Skull className="w-3 h-3" /> Snitch
                                            </button>
                                        )}
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                </div>
            )}

            {/* Instruction banner */}
            <div className="max-w-md mx-auto px-4 pt-4 relative z-10">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-sm text-emerald-300 text-center">
                    Tap items you ordered · Use +/- for shared dishes
                </div>
            </div>

            {/* Escape Requests (Host only) */}
            {escapeRequests.length > 0 && bill?.host_id === currentUserId && (
                <div className="max-w-md mx-auto px-4 pt-3 relative z-10">
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            Escape Requests
                        </div>
                        {escapeRequests.map(req => (
                            <div key={req.user_id} className="flex items-center justify-between gap-2 bg-zinc-900/60 rounded-lg p-3">
                                <span className="text-sm font-semibold text-zinc-200">{req.username}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleApproveLeave(req)}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all"
                                    >
                                        <UserCheck className="w-3.5 h-3.5" /> Let them cook
                                    </button>
                                    <button
                                        onClick={() => handleDenyLeave(req)}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-lg text-xs font-bold text-red-400 hover:bg-red-500/30 transition-all"
                                    >
                                        <ShieldX className="w-3.5 h-3.5" /> Block escape
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Items */}
            <div className="max-w-md mx-auto p-4 space-y-3 relative z-10">
                {items.map((item) => {
                    const claimQty = getClaimQty(item.id);
                    const claimed = claimQty > 0;
                    const isMultiQty = item.quantity > 1;
                    const myFraction = claims.find(c => c.item_id === item.id)?.share_fraction ?? 1.0;
                    const myLineTotal = item.price_per_unit * claimQty * myFraction;
                    const otherClaimers = getOtherClaimers(item.id);
                    const othersCount = otherClaimers.length;
                    const myMax = item.quantity - othersCount;
                    const isLockedByOthers = !claimed && othersCount >= item.quantity;
                    const lockedByLabel = otherClaimers.length === 1
                        ? otherClaimers[0].username
                        : `${otherClaimers.length} bros`;
                    const isSliderOpen = sliderItemId === item.id;

                    return (
                        <div key={item.id} className="space-y-0">
                            <div
                                onClick={() => !isLockedByOthers && handleItemClick(item)}
                                className={`w-full p-4 rounded-xl text-left transition-all border select-none ${
                                    isSliderOpen
                                        ? 'bg-amber-500/10 border-amber-500/40 rounded-b-none'
                                        : isLockedByOthers
                                            ? 'bg-zinc-900/30 border-zinc-800/50 opacity-50 cursor-not-allowed'
                                            : claimed
                                                ? 'bg-emerald-500/15 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                                                : 'bg-zinc-900/60 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-600 cursor-pointer'
                                } ${claimed && isMultiQty ? 'cursor-default' : ''}`}
                            >
                                <div className="flex justify-between items-center gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {isLockedByOthers ? (
                                            <div className="w-5 h-5 rounded-full border-2 border-zinc-600 flex items-center justify-center shrink-0">
                                                <Lock className="w-3 h-3 text-zinc-500" />
                                            </div>
                                        ) : isMultiQty && claimed ? (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={(e) => adjustQty(item, -1, e)}
                                                    className="w-7 h-7 rounded-lg bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors"
                                                >
                                                    <Minus className="w-3 h-3 text-zinc-200" />
                                                </button>
                                                <span className="w-6 text-center font-bold text-emerald-400 text-sm">
                                                    {claimQty}
                                                </span>
                                                <button
                                                    onClick={(e) => adjustQty(item, +1, e)}
                                                    disabled={claimQty >= myMax}
                                                    className="w-7 h-7 rounded-lg bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                >
                                                    <Plus className="w-3 h-3 text-zinc-200" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                                claimed ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'
                                            }`}>
                                                {claimed && <CheckCircle className="w-3 h-3 text-black" />}
                                            </div>
                                        )}

                                        <div className="min-w-0">
                                            <h3 className={`font-semibold truncate ${
                                                isLockedByOthers
                                                    ? 'text-zinc-500 line-through'
                                                    : claimed
                                                        ? 'text-emerald-400'
                                                        : 'text-zinc-200'
                                            }`}>
                                                {item.name}
                                                {claimed && myFraction < 1 && (
                                                    <span className="ml-2 text-xs font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded">
                                                        {Math.round(myFraction * 100)}%
                                                    </span>
                                                )}
                                            </h3>
                                            <p className="text-xs text-zinc-500">
                                                {isMultiQty
                                                    ? `${item.quantity}x total · ₹${item.price_per_unit.toFixed(2)} each`
                                                    : `₹${item.price_per_unit.toFixed(2)}`
                                                }
                                                {isLockedByOthers ? (
                                                    <span className="ml-2 text-rose-400 font-medium">
                                                        · <Lock className="w-3 h-3 inline" /> Claimed by {lockedByLabel}
                                                    </span>
                                                ) : othersCount > 0 ? (
                                                    <span className="ml-2 text-amber-400">
                                                        · {othersCount} by others
                                                    </span>
                                                ) : null}
                                            </p>
                                        </div>
                                    </div>

                                    <p className={`font-bold font-mono shrink-0 ${
                                        isLockedByOthers
                                            ? 'text-zinc-600'
                                            : claimed
                                                ? 'text-emerald-300'
                                                : 'text-zinc-100'
                                    }`}>
                                        {claimed
                                            ? `₹${myLineTotal.toFixed(2)}`
                                            : `₹${item.total_price.toFixed(2)}`
                                        }
                                    </p>
                                </div>
                            </div>

                            {/* Pizza Slider — inline below item */}
                            {isSliderOpen && (
                                <div className="bg-amber-500/5 border border-t-0 border-amber-500/40 rounded-b-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center gap-2 text-amber-400 text-sm font-bold">
                                        <Pizza className="w-4 h-4" />
                                        I ate {sliderPercent}% of this
                                    </div>
                                    <input
                                        type="range"
                                        min={10}
                                        max={100}
                                        step={10}
                                        value={sliderPercent}
                                        onChange={e => setSliderPercent(Number(e.target.value))}
                                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                    />
                                    <div className="flex items-center justify-between text-xs text-zinc-500">
                                        <span>10%</span>
                                        <span className="font-mono text-amber-300 font-bold">
                                            ₹{(item.price_per_unit * (sliderPercent / 100)).toFixed(2)}
                                        </span>
                                        <span>100%</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSliderItemId(null)}
                                            className="flex-1 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-bold text-zinc-400 hover:bg-zinc-700 transition-all"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => confirmPizzaSlider(item.id)}
                                            className="flex-1 py-2 bg-amber-500 rounded-lg text-sm font-bold text-black hover:bg-amber-400 transition-all flex items-center justify-center gap-1"
                                        >
                                            <CheckCircle className="w-3.5 h-3.5" /> Claim {sliderPercent}%
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* QR Code modal — desktop fallback */}
            {showQrModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4 text-center">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">Scan to Pay</h3>
                            <button onClick={() => setShowQrModal(false)} className="p-1 text-zinc-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-sm text-zinc-400">Open any UPI app on your phone and scan this QR code</p>
                        <div className="flex justify-center bg-white p-4 rounded-xl mx-auto w-fit">
                            <QRCodeSVG value={qrUpiUrl} size={200} level="M" />
                        </div>
                        <p className="text-xs text-zinc-500 font-mono break-all">{qrUpiUrl}</p>
                        <button
                            onClick={() => navigator.clipboard.writeText(qrUpiUrl).then(() => alert('UPI link copied!'))}
                            className="w-full py-3 gradient-emerald rounded-xl font-bold text-black flex items-center justify-center gap-2"
                        >
                            <Copy className="w-4 h-4" />
                            Copy UPI Link
                        </button>
                        {myPaymentStatus === 'unpaid' && (
                            <button
                                onClick={async () => {
                                    await handleMarkPaid();
                                    setShowQrModal(false);
                                }}
                                className="w-full py-3 bg-green-600 hover:bg-green-700 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-all"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                I've sent the money
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Broke Bro Roulette Modal */}
            {showRoulette && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => !rouletteSpinning && setShowRoulette(false)}>
                    <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Dices className="w-5 h-5 text-red-400" />
                                <h3 className="text-base font-bold text-white">Broke Bro Roulette</h3>
                            </div>
                            {!rouletteSpinning && (
                                <button onClick={() => setShowRoulette(false)} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all">
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <div className="p-5 space-y-4">
                            {rouletteLoser ? (
                                <div className="text-center space-y-3">
                                    <Skull className="w-12 h-12 text-red-500 mx-auto animate-bounce" />
                                    <p className="text-2xl font-black text-red-400">{rouletteLoser.username}</p>
                                    <p className="text-sm text-zinc-400">got absolutely cooked. Pay up or lose aura forever.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-sm text-zinc-400 text-center">
                                        {rouletteSpinning ? 'Spinning the wheel of financial doom...' : 'Who pays? Let fate decide.'}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {participants.filter(p => p.user_id !== bill?.host_id).map((p, i) => (
                                            <div
                                                key={p.user_id}
                                                className={`px-3 py-3 rounded-xl text-sm font-bold text-center transition-all duration-100 ${
                                                    rouletteSpinning && rouletteHighlight === i
                                                        ? 'bg-red-500/30 border-2 border-red-500 text-red-300 scale-105'
                                                        : 'bg-zinc-800 border border-zinc-700 text-zinc-300'
                                                }`}
                                            >
                                                {p.username}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {!rouletteSpinning && !rouletteLoser && isHost && (
                                <button
                                    onClick={startRoulette}
                                    className="w-full py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-all"
                                >
                                    <Dices className="w-4 h-4" /> Spin the Wheel
                                </button>
                            )}
                            {rouletteLoser && (
                                <button
                                    onClick={() => { setShowRoulette(false); setRouletteLoser(null); }}
                                    className="w-full py-3 bg-zinc-800 border border-zinc-700 rounded-xl font-bold text-zinc-300 hover:bg-zinc-700 transition-all"
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Low Taper Fade Modal */}
            {showTaperModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowTaperModal(false)}>
                    <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Scissors className="w-5 h-5 text-emerald-400" />
                                <h3 className="text-base font-bold text-white">Low Taper Fade</h3>
                            </div>
                            <button onClick={() => setShowTaperModal(false)} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-sm text-zinc-400">Trim some off your debt. Outstanding: <span className="text-emerald-400 font-bold">₹{myRemaining.toFixed(2)}</span></p>
                            <input
                                type="number"
                                value={taperAmount}
                                onChange={e => setTaperAmount(e.target.value)}
                                placeholder={`Max ₹${myRemaining.toFixed(0)}`}
                                autoFocus
                                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                            />
                            <button
                                onClick={handleTaperFade}
                                disabled={taperSaving || !taperAmount || parseFloat(taperAmount) <= 0 || parseFloat(taperAmount) > myRemaining}
                                className="w-full py-3 gradient-emerald rounded-xl font-bold text-black flex items-center justify-center gap-2 hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100"
                            >
                                {taperSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                Fade the Debt
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Beg for Mercy Modal */}
            {showMercyModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => !mercySaving && setShowMercyModal(false)}>
                    <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Heart className="w-5 h-5 text-purple-400" />
                                <h3 className="text-base font-bold text-white">Beg for Mercy</h3>
                            </div>
                            <button onClick={() => setShowMercyModal(false)} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-sm text-zinc-400">
                                Your debt is only <span className="text-purple-400 font-bold">₹{myRemaining.toFixed(2)}</span>. Publicly humiliate yourself to clear it.
                            </p>

                            {/* Tabs */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setMercyTab('text')}
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                                        mercyTab === 'text' ? 'bg-purple-500/20 border border-purple-500/40 text-purple-400' : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
                                    }`}
                                >
                                    <MessageSquare className="w-3.5 h-3.5" /> Written Apology
                                </button>
                                <button
                                    onClick={() => setMercyTab('audio')}
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all ${
                                        mercyTab === 'audio' ? 'bg-purple-500/20 border border-purple-500/40 text-purple-400' : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
                                    }`}
                                >
                                    <Mic className="w-3.5 h-3.5" /> Voice Note
                                </button>
                            </div>

                            {mercyTab === 'text' ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={mercyText}
                                        onChange={e => setMercyText(e.target.value)}
                                        placeholder="Write a 50-word minimum apology. Make it embarrassing..."
                                        rows={5}
                                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all resize-none"
                                    />
                                    <p className="text-xs text-zinc-500 text-right">
                                        {mercyText.trim().split(/\s+/).filter(Boolean).length}/50 words
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {mercyRecording ? (
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                                                <span className="text-sm text-red-400 font-semibold">Recording...</span>
                                                <span className="text-xs text-red-400/60 font-mono ml-auto">{Math.floor(mercyRecordTime / 60)}:{(mercyRecordTime % 60).toString().padStart(2, '0')}</span>
                                            </div>
                                            <button
                                                onClick={stopMercyRecording}
                                                className="p-3 bg-red-500 rounded-xl text-white hover:bg-red-400 transition-all shrink-0"
                                            >
                                                <Square className="w-5 h-5" />
                                            </button>
                                        </div>
                                    ) : mercyAudioUrl ? (
                                        <div className="space-y-2">
                                            <audio controls className="w-full h-10" src={mercyAudioUrl} />
                                            <button
                                                onClick={() => { setMercyAudioUrl(null); mercyChunksRef.current = []; setMercyRecordTime(0); }}
                                                className="text-xs text-zinc-500 hover:text-zinc-300 transition-all"
                                            >
                                                Re-record
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={startMercyRecording}
                                            className="w-full py-4 bg-zinc-800 border border-zinc-700 rounded-xl text-sm font-bold text-zinc-300 hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                                        >
                                            <Mic className="w-5 h-5 text-red-400" /> Start Recording (min 5 seconds)
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={submitMercy}
                                disabled={mercySaving || mercyRecording}
                                className="w-full py-3 bg-purple-500 hover:bg-purple-600 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                            >
                                {mercySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
                                Submit Mercy Request
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toasts */}
            {escapeToast && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold backdrop-blur-sm shadow-lg animate-pulse">
                    {escapeToast}
                </div>
            )}
            {billToast && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 max-w-sm px-5 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold backdrop-blur-sm shadow-lg">
                    {billToast}
                </div>
            )}

            {/* Fixed Bottom Bar */}
            <div className="fixed bottom-0 left-0 right-0 glass border-t border-zinc-800 p-4 z-20 backdrop-blur-xl bg-zinc-950/80">
                <div className="max-w-md mx-auto space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Your Items</span>
                        <span className="font-medium text-zinc-200">₹{mySubtotal.toFixed(2)}</span>
                    </div>
                    {taxShare > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-zinc-400">Tax & Charges (your share)</span>
                            <span className="font-medium text-zinc-200">₹{taxShare.toFixed(2)}</span>
                        </div>
                    )}
                    {myTotalPaid > 0 && (
                        <div className="flex justify-between text-sm">
                            <span className="text-emerald-400">Paid (Low Taper Fade)</span>
                            <span className="font-medium text-emerald-400">-₹{myTotalPaid.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
                        <span className="text-lg font-bold text-white">{myTotalPaid > 0 ? 'Remaining' : 'Total'}</span>
                        <span className={`text-2xl font-bold font-mono transition-all duration-500 ${myRemaining === 0 && myTotal > 0 ? 'text-emerald-400 line-through opacity-60' : 'text-emerald-400'}`}>
                            ₹{myRemaining.toFixed(2)}
                        </span>
                    </div>

                    {/* Payment status states */}
                    {isHost ? (
                        <div className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            You are the Host. Your share of the bill is ₹{myTotal.toFixed(2)}.
                        </div>
                    ) : myPaymentStatus === 'cleared' ? (
                        <div className="w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                            <CheckCircle2 className="w-5 h-5" />
                            Payment Cleared
                        </div>
                    ) : myPaymentStatus === 'pending_mercy' ? (
                        <div className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-purple-500/10 border border-purple-500/30 text-purple-400">
                            <Heart className="w-5 h-5" />
                            Mercy requested. Pray the Host accepts.
                        </div>
                    ) : myPaymentStatus === 'pending_audit' ? (
                        <div className="w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            <Hourglass className="w-5 h-5" />
                            Pending Host Audit... Waiting for them to confirm.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {/* Pay / QR button */}
                            {isMobile ? (
                                <a
                                    href={upiUrl || '#'}
                                    onClick={handleMobilePayClick}
                                    className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all no-underline ${myRemaining > 0
                                        ? 'gradient-emerald text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] active:scale-95'
                                        : 'bg-zinc-800 text-zinc-500 pointer-events-none'
                                    }`}
                                >
                                    <IndianRupee className="w-5 h-5" />
                                    {myRemaining > 0 ? `Pay ₹${myRemaining.toFixed(2)}` : 'Select items to pay'}
                                </a>
                            ) : (
                                <button
                                    onClick={handlePayDesktop}
                                    className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${myRemaining > 0
                                        ? 'gradient-emerald text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02]'
                                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                    }`}
                                >
                                    <IndianRupee className="w-5 h-5" />
                                    {myRemaining > 0 ? `Pay ₹${myRemaining.toFixed(2)} via QR` : 'Select items to pay'}
                                </button>
                            )}

                            {/* Low Taper Fade + I Paid buttons row */}
                            {myRemaining > 0 && !isHost && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowTaperModal(true)}
                                        className="flex-1 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm font-bold text-zinc-300 hover:bg-zinc-700 transition-all flex items-center justify-center gap-1.5"
                                    >
                                        <Scissors className="w-4 h-4" /> Low Taper Fade
                                    </button>
                                    <button
                                        onClick={handleMarkPaid}
                                        className="flex-1 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-1.5"
                                    >
                                        <CheckCircle2 className="w-4 h-4" /> I sent the UPI
                                    </button>
                                </div>
                            )}

                            {/* Beg for Mercy — only if debt <= ₹50 */}
                            {canBegForMercy && (
                                <button
                                    onClick={() => { setShowMercyModal(true); setMercyText(''); setMercyAudioUrl(null); setMercyTab('text'); }}
                                    className="w-full py-2.5 bg-purple-500/10 border border-purple-500/30 rounded-xl text-sm font-bold text-purple-400 hover:bg-purple-500/20 transition-all flex items-center justify-center gap-1.5"
                                >
                                    <Heart className="w-4 h-4" /> Beg for Mercy (under ₹50)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
