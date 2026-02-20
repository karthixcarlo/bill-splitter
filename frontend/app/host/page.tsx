'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase';
import { Upload, Loader2, Camera, Trash2, Plus } from 'lucide-react';

type ViewMode = 'upload' | 'scanning' | 'editor';

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

export default function HostPage() {
    const router = useRouter();
    const [viewMode, setViewMode] = useState<ViewMode>('upload');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string>('');
    const [billData, setBillData] = useState<BillData | null>(null);

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

    async function handleParseBill() {
        if (!selectedFile) return;

        setViewMode('scanning');
        try {
            const user = await getCurrentUser();
            // For dev/testing: use a stable placeholder UUID if not signed in
            const hostId = user?.id ?? '00000000-0000-0000-0000-000000000001';

            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('host_id', hostId);

            // Use 120s timeout — Gemini vision can take a while
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort('timeout'), 120_000);

            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            const response = await fetch(`${apiUrl}/api/parse-bill`, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            const result = await response.json();

            if (!response.ok) {
                // Show the real error from the backend
                const errMsg = result.detail || result.message || `Error ${response.status}`;
                alert(`Parse Error: ${errMsg}`);
                setViewMode('upload');
                return;
            }

            if (result.success && result.data) {
                setBillData(result.data);
                setViewMode('editor');
            } else {
                alert('Could not parse bill. Please upload a clear photo of a restaurant receipt.');
                setViewMode('upload');
            }
        } catch (error: any) {
            console.error('Error parsing bill:', error);
            alert(`Failed to reach backend: ${error?.message || 'Unknown error'}. Is the backend running on port 8000?`);
            setViewMode('upload');
        }
    }

    function updateItem(index: number, field: keyof BillItem, value: any) {
        if (!billData) return;
        const newItems = [...billData.items];
        newItems[index] = { ...newItems[index], [field]: value };

        // Recalculate total_price if qty or price_per_unit changed
        if (field === 'quantity' || field === 'price_per_unit') {
            newItems[index].total_price = newItems[index].quantity * newItems[index].price_per_unit;
        }

        setBillData({ ...billData, items: newItems });
    }

    function deleteItem(index: number) {
        if (!billData) return;
        const newItems = billData.items.filter((_, i) => i !== index);
        setBillData({ ...billData, items: newItems });
    }

    function addItem() {
        if (!billData) return;
        const newItem: BillItem = {
            name: 'New Item',
            quantity: 1,
            price_per_unit: 0,
            total_price: 0
        };
        setBillData({ ...billData, items: [...billData.items, newItem] });
    }

    function calculateTotal() {
        if (!billData) return 0;
        const itemsTotal = billData.items.reduce((sum, item) => sum + item.total_price, 0);
        return itemsTotal + billData.tax_amount + billData.service_charge;
    }

    async function handleCreatePartyRoom() {
        if (!billData) return;

        setViewMode('scanning'); // reuse the loading spinner

        try {
            // Generate a short 6-char bill code (e.g. "AB12CD")
            const billCode = Math.random().toString(36).substring(2, 8).toUpperCase();

            // Build the full bill object to store
            const fullBill = {
                id: billCode,
                restaurant_name: billData.restaurant_name || 'Restaurant',
                items: billData.items.map((item, idx) => ({
                    ...item,
                    id: `item_${billCode}_${idx}`,
                })),
                tax_amount: billData.tax_amount,
                service_charge: billData.service_charge,
                total: calculateTotal(),
                created_at: new Date().toISOString(),
                host_id: 'dev_host',
            };

            // Save to localStorage so the bill page can load it without Supabase
            localStorage.setItem(`bill_${billCode}`, JSON.stringify(fullBill));

            // Navigate to the bill claiming page
            router.push(`/bill/${billCode}`);
        } catch (error: any) {
            console.error('Error creating party room:', error);
            alert('Failed to create party room: ' + (error?.message || 'Unknown error'));
            setViewMode('editor');
        }
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-6 pb-24 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.4] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-950/50 to-zinc-950 pointer-events-none" />

            <div className="max-w-2xl mx-auto space-y-6 pt-8 relative z-10">
                {/* Upload Phase */}
                {viewMode === 'upload' && (
                    <>
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold text-white">Upload Bill</h1>
                            <p className="text-zinc-400">
                                Take a photo or upload an image of your restaurant bill
                            </p>
                        </div>

                        {!preview ? (
                            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-emerald-500 hover:bg-zinc-900/50 transition-all bg-zinc-900/20 backdrop-blur-sm">
                                <Camera className="w-12 h-12 text-zinc-500 mb-3" />
                                <span className="text-zinc-300 mb-1 font-medium">Click to upload bill</span>
                                <span className="text-sm text-zinc-500">JPG, PNG up to 10MB</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                            </label>
                        ) : (
                            <div className="space-y-4">
                                <div className="relative group">
                                    <div className="absolute -inset-0.5 bg-emerald-500/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
                                    <img
                                        src={preview}
                                        alt="Bill Preview"
                                        className="relative w-full rounded-xl border border-zinc-800 shadow-2xl"
                                    />
                                </div>

                                <button
                                    onClick={handleParseBill}
                                    className="w-full py-4 gradient-emerald rounded-xl font-bold text-black text-lg flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-[1.02] transition-transform"
                                >
                                    <Upload className="w-6 h-6" />
                                    Parse Bill with AI
                                </button>

                                <button
                                    onClick={() => {
                                        setSelectedFile(null);
                                        setPreview('');
                                    }}
                                    className="w-full py-3 text-zinc-400 hover:text-white transition-colors"
                                >
                                    Choose Different Image
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Scanning Phase */}
                {viewMode === 'scanning' && (
                    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
                        <Loader2 className="w-16 h-16 animate-spin text-emerald-500" />
                        <div className="text-center space-y-2">
                            <h2 className="text-2xl font-bold text-white">AI is analyzing your bill...</h2>
                            <p className="text-zinc-400">This usually takes a few seconds</p>
                        </div>
                    </div>
                )}

                {/* Editor Phase */}
                {viewMode === 'editor' && billData && (
                    <>
                        <div className="space-y-2">
                            <h1 className="text-3xl font-bold text-white">Verify Bill Items</h1>
                            <p className="text-zinc-400">
                                Review and edit items before creating your party room
                            </p>
                        </div>

                        <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-2xl overflow-hidden">
                            {/* Receipt Header */}
                            <div className="bg-zinc-900 p-6 border-b border-zinc-800">
                                <input
                                    type="text"
                                    value={billData.restaurant_name || 'Restaurant Name'}
                                    onChange={(e) => setBillData({ ...billData, restaurant_name: e.target.value })}
                                    className="text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-emerald-500 outline-none transition-colors w-full font-mono"
                                />
                            </div>

                            {/* Items List */}
                            <div className="p-6 space-y-3">
                                {billData.items.map((item, idx) => (
                                    <div key={idx} className="grid grid-cols-12 gap-2 items-center p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
                                        <input
                                            type="text"
                                            value={item.name}
                                            onChange={(e) => updateItem(idx, 'name', e.target.value)}
                                            className="col-span-5 bg-transparent text-zinc-200 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors"
                                            placeholder="Item name"
                                        />

                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                            className="col-span-2 bg-transparent text-zinc-300 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-center"
                                            placeholder="Qty"
                                        />

                                        <input
                                            type="number"
                                            value={item.price_per_unit}
                                            onChange={(e) => updateItem(idx, 'price_per_unit', parseFloat(e.target.value) || 0)}
                                            className="col-span-2 bg-transparent text-zinc-300 font-mono text-sm outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right"
                                            placeholder="Price"
                                        />

                                        <div className="col-span-2 text-right text-emerald-400 font-mono font-semibold text-sm">
                                            ₹{item.total_price.toFixed(2)}
                                        </div>

                                        <button
                                            onClick={() => deleteItem(idx)}
                                            className="col-span-1 text-red-400 hover:text-red-300 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}

                                <button
                                    onClick={addItem}
                                    className="w-full py-3 border border-dashed border-zinc-700 rounded-lg text-zinc-400 hover:text-emerald-400 hover:border-emerald-500 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Item
                                </button>
                            </div>

                            {/* Receipt Footer */}
                            <div className="bg-zinc-900 p-6 border-t border-zinc-800 space-y-3">
                                <div className="flex justify-between text-sm font-mono">
                                    <span className="text-zinc-400">Tax</span>
                                    <input
                                        type="number"
                                        value={billData.tax_amount}
                                        onChange={(e) => setBillData({ ...billData, tax_amount: parseFloat(e.target.value) || 0 })}
                                        className="bg-transparent text-zinc-300 outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right w-24"
                                    />
                                </div>
                                <div className="flex justify-between text-sm font-mono">
                                    <span className="text-zinc-400">Service Charge</span>
                                    <input
                                        type="number"
                                        value={billData.service_charge}
                                        onChange={(e) => setBillData({ ...billData, service_charge: parseFloat(e.target.value) || 0 })}
                                        className="bg-transparent text-zinc-300 outline-none border-b border-transparent hover:border-zinc-600 focus:border-emerald-500 transition-colors text-right w-24"
                                    />
                                </div>
                                <div className="h-px bg-zinc-700" />
                                <div className="flex justify-between text-xl font-mono font-bold">
                                    <span className="text-white">Total</span>
                                    <span className="text-emerald-400">₹{calculateTotal().toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleCreatePartyRoom}
                            className="w-full py-4 gradient-emerald rounded-xl font-bold text-black text-lg shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:scale-[1.02] transition-transform"
                        >
                            Create Party Room
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
