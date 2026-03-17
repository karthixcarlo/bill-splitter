'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { ArrowLeft, Send, Loader2, Mic, Square, Play, Pause } from 'lucide-react';

interface Message {
    id: string;
    sender_id: string;
    receiver_id: string;
    content: string;
    audio_url?: string | null;
    created_at: string;
}

function VoicePlayer({ url, isMine }: { url: string; isMine: boolean }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const onEnd = () => setPlaying(false);
        const onTime = () => setCurrent(audio.currentTime);
        const onMeta = () => setDuration(audio.duration);
        audio.addEventListener('ended', onEnd);
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('loadedmetadata', onMeta);
        return () => {
            audio.removeEventListener('ended', onEnd);
            audio.removeEventListener('timeupdate', onTime);
            audio.removeEventListener('loadedmetadata', onMeta);
        };
    }, []);

    function toggle() {
        const audio = audioRef.current;
        if (!audio) return;
        if (playing) { audio.pause(); setPlaying(false); }
        else { audio.play(); setPlaying(true); }
    }

    const fmt = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const pct = duration > 0 ? (current / duration) * 100 : 0;

    return (
        <div className="flex items-center gap-2 min-w-[160px]">
            <audio ref={audioRef} src={url} preload="metadata" />
            <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isMine ? 'bg-emerald-500/30' : 'bg-zinc-700'}`}>
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div className="flex-1 space-y-1">
                <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${isMine ? 'bg-emerald-400' : 'bg-zinc-400'}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`text-[10px] ${isMine ? 'text-emerald-400/60' : 'text-zinc-500'}`}>
                    {playing ? fmt(current) : fmt(duration || 0)}
                </p>
            </div>
        </div>
    );
}

export default function ChatPage() {
    const params = useParams();
    const router = useRouter();
    const friendId = params.friendId as string;

    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState('');
    const [friendName, setFriendName] = useState('');
    const [friendVibe, setFriendVibe] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);

    // Voice recording
    const [recording, setRecording] = useState(false);
    const [recordTime, setRecordTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        async function init() {
            const user = await getCurrentUser();
            if (!user) { router.push('/'); return; }
            setUserId(user.id);

            const { data: friend } = await supabase
                .from('users')
                .select('username, vibe')
                .eq('id', friendId)
                .single();
            if (friend) {
                setFriendName(friend.username);
                setFriendVibe(friend.vibe || '');
            }

            const { data: msgs } = await supabase
                .from('messages')
                .select('*')
                .or(`and(sender_id.eq.${user.id},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${user.id})`)
                .order('created_at', { ascending: true })
                .limit(100);
            setMessages((msgs ?? []) as Message[]);
            setLoading(false);
        }
        init();
    }, [friendId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (!userId || !friendId) return;

        const channel = supabase
            .channel(`chat_${[userId, friendId].sort().join('_')}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    const msg = payload.new as Message;
                    const isOurs =
                        (msg.sender_id === userId && msg.receiver_id === friendId) ||
                        (msg.sender_id === friendId && msg.receiver_id === userId);
                    if (!isOurs) return;
                    setMessages(prev => {
                        if (prev.some(m => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [userId, friendId]);

    async function handleSend() {
        const content = newMessage.trim();
        if (!content || sending) return;
        setSending(true);
        setNewMessage('');

        const { data } = await supabase.from('messages').insert({
            sender_id: userId,
            receiver_id: friendId,
            content,
        }).select().single();

        if (data) {
            setMessages(prev => {
                if (prev.some(m => m.id === data.id)) return prev;
                return [...prev, data as Message];
            });
        }
        setSending(false);
        inputRef.current?.focus();
    }

    // ─── Voice recording ────────────────────────────────────────────────────────
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            chunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                handleVoiceUpload();
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
            setRecording(true);
            setRecordTime(0);
            timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);
        } catch {
            alert('Microphone access denied');
        }
    }

    function stopRecording() {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        mediaRecorderRef.current?.stop();
        setRecording(false);
    }

    async function handleVoiceUpload() {
        if (!chunksRef.current.length) return;
        setSending(true);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const filename = `${userId}_${Date.now()}.webm`;

        const { error: uploadError } = await supabase.storage
            .from('voice_notes')
            .upload(filename, blob, { contentType: 'audio/webm' });

        if (uploadError) {
            console.error('Voice upload failed:', uploadError);
            setSending(false);
            return;
        }

        const { data: urlData } = supabase.storage
            .from('voice_notes')
            .getPublicUrl(filename);

        const audioUrl = urlData?.publicUrl;
        if (!audioUrl) { setSending(false); return; }

        const { data } = await supabase.from('messages').insert({
            sender_id: userId,
            receiver_id: friendId,
            content: 'Voice note',
            audio_url: audioUrl,
        }).select().single();

        if (data) {
            setMessages(prev => {
                if (prev.some(m => m.id === data.id)) return prev;
                return [...prev, data as Message];
            });
        }
        setSending(false);
    }

    function formatTime(iso: string) {
        return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }

    function avatarInitial(name: string) {
        return name?.[0]?.toUpperCase() ?? '?';
    }

    const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-zinc-950">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-zinc-950 text-zinc-200">
            {/* Header */}
            <div className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-xl px-4 py-3">
                <div className="max-w-md md:max-w-2xl mx-auto flex items-center gap-3">
                    <button
                        onClick={() => router.push('/friends')}
                        className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center font-bold text-white shrink-0">
                        {avatarInitial(friendName)}
                    </div>
                    <div className="min-w-0">
                        <h1 className="font-bold text-white truncate">{friendName}</h1>
                        {friendVibe && (
                            <p className="text-xs text-zinc-500 italic truncate">"{friendVibe}"</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="max-w-md md:max-w-2xl mx-auto space-y-3">
                    {messages.length === 0 && (
                        <div className="text-center py-16 text-zinc-600">
                            <p className="text-sm">No messages yet</p>
                            <p className="text-xs mt-1">Say something to start the conversation</p>
                        </div>
                    )}
                    {messages.map(msg => {
                        const isMine = msg.sender_id === userId;
                        return (
                            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
                                    isMine
                                        ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-100 rounded-br-md'
                                        : 'bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-bl-md'
                                }`}>
                                    {msg.audio_url ? (
                                        <VoicePlayer url={msg.audio_url} isMine={isMine} />
                                    ) : (
                                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                    )}
                                    {!msg.audio_url && (
                                        <p className={`text-[10px] mt-1 ${isMine ? 'text-emerald-400/60' : 'text-zinc-500'}`}>
                                            {formatTime(msg.created_at)}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-xl px-4 py-3">
                <div className="max-w-md md:max-w-2xl mx-auto">
                    {recording ? (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-sm text-red-400 font-semibold">Recording Skibidi...</span>
                                <span className="text-xs text-red-400/60 font-mono ml-auto">{fmtTimer(recordTime)}</span>
                            </div>
                            <button
                                onClick={stopRecording}
                                className="p-3 bg-red-500 rounded-xl text-white hover:bg-red-400 transition-all shrink-0"
                            >
                                <Square className="w-5 h-5" />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <input
                                ref={inputRef}
                                type="text"
                                value={newMessage}
                                onChange={e => setNewMessage(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSend()}
                                placeholder="Type a message..."
                                className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                            />
                            <button
                                onClick={startRecording}
                                className="p-3 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all shrink-0"
                                title="Tap to record voice note"
                            >
                                <Mic className="w-5 h-5" />
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={!newMessage.trim() || sending}
                                className="p-3 bg-emerald-500 rounded-xl text-black hover:bg-emerald-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                            >
                                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
