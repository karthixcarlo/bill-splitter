'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, getCurrentUser, updateUserProfile, authHeaders, API_URL } from '@/lib/supabase';
import { Upload, CheckCircle2, Loader2 } from 'lucide-react';

export default function OnboardPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>}>
            <OnboardContent />
        </Suspense>
    );
}

function OnboardContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const returnTo = searchParams.get('returnTo') || '';
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [extractedVPA, setExtractedVPA] = useState<string>('');
    const [username, setUsername] = useState('');
    const [vibe, setVibe] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        async function checkSession() {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) router.push('/');
        }
        checkSession();
    }, []);

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    }

    async function handleScanQR() {
        if (!selectedFile) return;

        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            const headers = await authHeaders();
            const response = await fetch(`${API_URL}/api/scan-qr`, {
                method: 'POST',
                body: formData,
                headers,
            });

            const data = await response.json();

            if (data.success) {
                setExtractedVPA(data.vpa);
            } else {
                alert('Could not extract UPI VPA from QR code');
            }
        } catch (error) {
            console.error('Error scanning QR:', error);
            alert('Failed to scan QR code');
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveProfile() {
        if (!username || !extractedVPA) {
            alert('Please provide username and scan QR code');
            return;
        }

        setLoading(true);
        try {
            const user = await getCurrentUser();
            if (!user) {
                alert('Please sign in first');
                return;
            }

            await updateUserProfile(user.id, {
                username,
                upi_vpa: extractedVPA,
                ...(vibe.trim() ? { vibe: vibe.trim() } : {}),
            });

            setSuccess(true);
            setTimeout(() => {
                router.push(returnTo || '/home');
            }, 2000);
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Failed to save profile');
        } finally {
            setLoading(false);
        }
    }

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6">
                <div className="text-center space-y-4">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto animate-fade-in" />
                    <h2 className="text-2xl font-bold">Profile Set Up! 🎉</h2>
                    <p className="text-zinc-400">Redirecting...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-6">
            <div className="max-w-md mx-auto space-y-6 pt-8">
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold">Set Up Your Profile</h1>
                    <p className="text-zinc-400">
                        We'll extract your UPI ID from your payment QR code
                    </p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your name"
                            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Your Vibe <span className="text-zinc-600 font-normal">(optional)</span></label>
                        <select
                            value={vibe}
                            onChange={(e) => setVibe(e.target.value)}
                            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-zinc-200 appearance-none"
                        >
                            <option value="">Pick your vibe...</option>
                            <option value="Will pay you back in 3-5 business days">Will pay you back in 3-5 business days</option>
                            <option value="Professional freeloader">Professional freeloader</option>
                            <option value="Math ain't mathing">Math ain't mathing</option>
                            <option value="Here for the vibes, not the bill">Here for the vibes, not the bill</option>
                            <option value="I only had a Diet Coke">I only had a Diet Coke</option>
                            <option value="Designated UPI scanner">Designated UPI scanner</option>
                        </select>
                    </div>

                    <div className="glass p-6 rounded-xl space-y-4">
                        <h3 className="font-semibold">Upload Payment QR Code</h3>
                        <p className="text-sm text-zinc-400">
                            Take a screenshot of your GPay/PhonePe QR code
                        </p>

                        {!preview ? (
                            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-zinc-700 rounded-lg cursor-pointer hover:border-emerald-500 transition-colors">
                                <Upload className="w-8 h-8 text-zinc-500 mb-2" />
                                <span className="text-sm text-zinc-500">Click to upload</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                            </label>
                        ) : (
                            <div className="space-y-4">
                                <img
                                    src={preview}
                                    alt="QR Code Preview"
                                    className="w-full h-48 object-contain bg-white rounded-lg"
                                />
                                <button
                                    onClick={handleScanQR}
                                    disabled={loading}
                                    className="w-full py-3 gradient-emerald rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Scanning...
                                        </>
                                    ) : (
                                        'Scan QR Code'
                                    )}
                                </button>
                            </div>
                        )}

                        {extractedVPA && (
                            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                                <p className="text-sm text-zinc-400">Extracted UPI ID:</p>
                                <p className="font-mono text-emerald-400">{extractedVPA}</p>
                            </div>
                        )}
                    </div>

                    {extractedVPA && username && (
                        <button
                            onClick={handleSaveProfile}
                            disabled={loading}
                            className="w-full py-3 gradient-emerald rounded-lg font-semibold disabled:opacity-50"
                        >
                            Save Profile
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
