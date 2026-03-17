'use client';

import { Zap } from 'lucide-react';

interface AuraBadgeProps {
    score: number;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
}

function getAuraColor(score: number): string {
    if (score >= 800) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 600) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
    if (score >= 400) return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
    if (score >= 200) return 'text-zinc-400 border-zinc-500/40 bg-zinc-500/10';
    return 'text-red-400 border-red-500/40 bg-red-500/10';
}

function getAuraTitle(score: number): string {
    if (score >= 800) return 'Sigma';
    if (score >= 600) return 'Alpha';
    if (score >= 400) return 'Mid';
    if (score >= 200) return 'NPC';
    return 'Broke';
}

export default function AuraBadge({ score, size = 'sm', showLabel = false }: AuraBadgeProps) {
    const colorClass = getAuraColor(score);
    const sizeClasses = {
        sm: 'text-[10px] px-1.5 py-0.5 gap-0.5',
        md: 'text-xs px-2 py-1 gap-1',
        lg: 'text-sm px-3 py-1.5 gap-1.5',
    };
    const iconSizes = { sm: 'w-2.5 h-2.5', md: 'w-3 h-3', lg: 'w-3.5 h-3.5' };

    return (
        <span className={`inline-flex items-center rounded-full border font-bold ${colorClass} ${sizeClasses[size]}`}>
            <Zap className={iconSizes[size]} />
            {score}
            {showLabel && <span className="opacity-70 ml-0.5">{getAuraTitle(score)}</span>}
        </span>
    );
}
