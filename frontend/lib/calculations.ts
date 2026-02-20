interface BillItem {
    id: string;
    name: string;
    quantity: number;
    price_per_unit: number;
    total_price: number;
}

interface Claim {
    id: string;
    item_id: string;
    user_id: string;
    share_fraction: number;
}

/**
 * Calculate the total amount a user owes for a bill
 * @param userId - The user's ID
 * @param items - All bill items
 * @param claims - All claims on the bill
 * @param taxAmount - Total tax amount to be split
 * @param serviceCharge - Total service charge to be split
 * @returns Total amount the user owes
 */
export function calculateUserTotal(
    userId: string,
    items: BillItem[],
    claims: Claim[],
    taxAmount: number = 0,
    serviceCharge: number = 0
): number {
    // Calculate subtotal for this user
    let userSubtotal = 0;

    // Get user's claims
    const userClaims = claims.filter(claim => claim.user_id === userId);

    // Calculate cost for each claimed item
    for (const claim of userClaims) {
        const item = items.find(i => i.id === claim.item_id);
        if (item) {
            // User pays their share of the item
            userSubtotal += item.total_price * claim.share_fraction;
        }
    }

    // Calculate total subtotal (sum of all items)
    const totalSubtotal = items.reduce((sum, item) => sum + item.total_price, 0);

    // Calculate user's proportion of the total
    const userProportion = totalSubtotal > 0 ? userSubtotal / totalSubtotal : 0;

    // Apply tax and service charge proportionally
    const userTax = taxAmount * userProportion;
    const userServiceCharge = serviceCharge * userProportion;

    // Return total
    return userSubtotal + userTax + userServiceCharge;
}

/**
 * Get count of claimants for a specific item
 */
export function getClaimantCount(itemId: string, claims: Claim[]): number {
    return claims.filter(claim => claim.item_id === itemId).length;
}

/**
 * Check if a user has claimed a specific item
 */
export function hasUserClaimed(userId: string, itemId: string, claims: Claim[]): boolean {
    return claims.some(claim => claim.user_id === userId && claim.item_id === itemId);
}
