import { describe, it, expect } from 'vitest';
import { calculateUserTotal, getClaimantCount, hasUserClaimed } from './calculations';

// ---- Fixtures ----------------------------------------------------------------

const ITEM_A = { id: 'item-a', name: 'Burger', quantity: 1, price_per_unit: 10, total_price: 10 };
const ITEM_B = { id: 'item-b', name: 'Fries', quantity: 2, price_per_unit: 5, total_price: 10 };
const ITEM_C = { id: 'item-c', name: 'Soda', quantity: 1, price_per_unit: 4, total_price: 4 };

const claim = (id: string, userId: string, itemId: string, share = 1) =>
    ({ id, user_id: userId, item_id: itemId, share_fraction: share });

// ---- calculateUserTotal ------------------------------------------------------

describe('calculateUserTotal', () => {
    it('returns 0 when user has no claims', () => {
        const result = calculateUserTotal('user-1', [ITEM_A], [], 2, 1);
        expect(result).toBe(0);
    });

    it('returns item total when user claims one item fully (no tax/service)', () => {
        const claims = [claim('c1', 'user-1', 'item-a')];
        const result = calculateUserTotal('user-1', [ITEM_A], claims);
        expect(result).toBe(10);
    });

    it('applies share_fraction when user claims half of an item', () => {
        const claims = [claim('c1', 'user-1', 'item-a', 0.5)];
        const result = calculateUserTotal('user-1', [ITEM_A], claims);
        expect(result).toBe(5);
    });

    it('sums multiple claimed items', () => {
        const claims = [
            claim('c1', 'user-1', 'item-a'),
            claim('c2', 'user-1', 'item-b'),
        ];
        const result = calculateUserTotal('user-1', [ITEM_A, ITEM_B], claims);
        expect(result).toBe(20);
    });

    it('distributes tax proportionally based on share of total bill', () => {
        // user-1 claims item-a (10 out of 20 total) → 50% of tax (4) = 2
        const claims = [claim('c1', 'user-1', 'item-a')];
        const result = calculateUserTotal('user-1', [ITEM_A, ITEM_B], claims, 4, 0);
        expect(result).toBe(12); // 10 items + 2 tax
    });

    it('distributes service charge proportionally', () => {
        // user-1 claims item-a (10/20 = 50%) → 50% of service charge (6) = 3
        const claims = [claim('c1', 'user-1', 'item-a')];
        const result = calculateUserTotal('user-1', [ITEM_A, ITEM_B], claims, 0, 6);
        expect(result).toBe(13); // 10 items + 3 service
    });

    it('distributes both tax and service charge proportionally', () => {
        // user-1 claims all items (20/20 = 100%) → all tax (2) + all service (1)
        const claims = [
            claim('c1', 'user-1', 'item-a'),
            claim('c2', 'user-1', 'item-b'),
        ];
        const result = calculateUserTotal('user-1', [ITEM_A, ITEM_B], claims, 2, 1);
        expect(result).toBe(23); // 20 + 2 + 1
    });

    it('returns 0 when totalSubtotal is 0 (no items) — avoids division by zero', () => {
        const result = calculateUserTotal('user-1', [], [], 10, 5);
        expect(result).toBe(0);
    });

    it('handles two users each claiming different items independently', () => {
        const items = [ITEM_A, ITEM_B]; // total 20
        const claims = [
            claim('c1', 'user-1', 'item-a'), // 10
            claim('c2', 'user-2', 'item-b'), // 10
        ];
        const user1Total = calculateUserTotal('user-1', items, claims, 4, 0);
        const user2Total = calculateUserTotal('user-2', items, claims, 4, 0);
        // Each has 50% of bill → 2 tax each
        expect(user1Total).toBe(12);
        expect(user2Total).toBe(12);
    });

    it('handles fractional shares with floating-point precision (1/3 share)', () => {
        // item-a = 9, shared equally among 3 users
        const ITEM_9 = { ...ITEM_A, total_price: 9 };
        const claims = [claim('c1', 'user-1', 'item-a', 1 / 3)];
        const result = calculateUserTotal('user-1', [ITEM_9], claims);
        // 9 * (1/3) = 3 — check value is close (floating point)
        expect(result).toBeCloseTo(3, 5);
    });

    it('ignores claims for other users when calculating target user total', () => {
        const items = [ITEM_A, ITEM_B, ITEM_C]; // total 24
        const claims = [
            claim('c1', 'user-1', 'item-a'),  // 10
            claim('c2', 'user-2', 'item-b'),  // 10
            claim('c3', 'user-2', 'item-c'),  // 4
        ];
        // user-1 has 10/24 of bill → proportion for tax
        const result = calculateUserTotal('user-1', items, claims, 12, 0);
        // tax: 12 * (10/24) = 5
        expect(result).toBeCloseTo(15, 5);
    });
});

// ---- getClaimantCount --------------------------------------------------------

describe('getClaimantCount', () => {
    it('returns 0 when no one has claimed the item', () => {
        expect(getClaimantCount('item-a', [])).toBe(0);
    });

    it('returns 1 when one user has claimed the item', () => {
        const claims = [claim('c1', 'user-1', 'item-a')];
        expect(getClaimantCount('item-a', claims)).toBe(1);
    });

    it('returns correct count when multiple users have claimed the item', () => {
        const claims = [
            claim('c1', 'user-1', 'item-a'),
            claim('c2', 'user-2', 'item-a'),
            claim('c3', 'user-3', 'item-a'),
        ];
        expect(getClaimantCount('item-a', claims)).toBe(3);
    });

    it('does not count claims for other items', () => {
        const claims = [
            claim('c1', 'user-1', 'item-a'),
            claim('c2', 'user-2', 'item-b'),
        ];
        expect(getClaimantCount('item-a', claims)).toBe(1);
    });
});

// ---- hasUserClaimed ----------------------------------------------------------

describe('hasUserClaimed', () => {
    it('returns false when claims list is empty', () => {
        expect(hasUserClaimed('user-1', 'item-a', [])).toBe(false);
    });

    it('returns true when user has claimed the item', () => {
        const claims = [claim('c1', 'user-1', 'item-a')];
        expect(hasUserClaimed('user-1', 'item-a', claims)).toBe(true);
    });

    it('returns false when user has not claimed the item', () => {
        const claims = [claim('c1', 'user-2', 'item-a')];
        expect(hasUserClaimed('user-1', 'item-a', claims)).toBe(false);
    });

    it('returns false when user claimed a different item', () => {
        const claims = [claim('c1', 'user-1', 'item-b')];
        expect(hasUserClaimed('user-1', 'item-a', claims)).toBe(false);
    });

    it('returns true when user claimed multiple items (checks specific item)', () => {
        const claims = [
            claim('c1', 'user-1', 'item-a'),
            claim('c2', 'user-1', 'item-b'),
        ];
        expect(hasUserClaimed('user-1', 'item-b', claims)).toBe(true);
    });
});
