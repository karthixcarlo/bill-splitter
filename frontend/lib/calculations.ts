export interface BillItem {
    id: string;
    name: string;
    quantity: number;
    price_per_unit: number;
    total_price: number;
}

export interface LocalClaim {
    item_id: string;
    qty_claimed: number;
    share_fraction?: number; // 0.1–1.0; defaults to 1.0 if absent
}

/**
 * User's subtotal = sum of (price_per_unit * qty_claimed * share_fraction) for each claim.
 * share_fraction defaults to 1.0 (full claim) when not set — backwards compatible.
 */
export function calculateUserSubtotal(items: BillItem[], claims: LocalClaim[]): number {
    return claims.reduce((sum, claim) => {
        const item = items.find(i => i.id === claim.item_id);
        if (!item) return sum;
        const fraction = claim.share_fraction ?? 1.0;
        return sum + item.price_per_unit * claim.qty_claimed * fraction;
    }, 0);
}

/**
 * Proportional share of tax + service charge based on subtotal vs full bill.
 */
export function calculateTaxShare(
    userSubtotal: number,
    billTotal: number,
    taxAmount: number,
    serviceCharge: number
): number {
    if (billTotal === 0) return 0;
    return (taxAmount + serviceCharge) * (userSubtotal / billTotal);
}
