import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateUPIIntent, isUPISupported, openUPIApp } from './upi';

// ---- generateUPIIntent -------------------------------------------------------

describe('generateUPIIntent', () => {
    it('produces a URL starting with upi://pay?', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100);
        expect(url).toMatch(/^upi:\/\/pay\?/);
    });

    it('includes the correct VPA (pa parameter)', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100);
        expect(url).toContain('pa=user%40okaxis');
    });

    it('includes the payee name (pn parameter)', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100);
        expect(url).toContain('pn=Alice');
    });

    it('formats amount to 2 decimal places', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 99.9);
        expect(url).toContain('am=99.90');
    });

    it('formats whole-number amount with two decimal places', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 50);
        expect(url).toContain('am=50.00');
    });

    it('always sets currency to INR (cu parameter)', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100);
        expect(url).toContain('cu=INR');
    });

    it('uses default note when none is provided', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100);
        // URLSearchParams encodes spaces as +
        expect(url).toMatch(/tn=Bill\+Split\+Payment|tn=Bill%20Split%20Payment/);
    });

    it('uses provided payment note (tn parameter)', () => {
        const url = generateUPIIntent('user@okaxis', 'Alice', 100, 'Dinner split');
        expect(url).toMatch(/tn=Dinner\+split|tn=Dinner%20split/);
    });

    it('URL-encodes special characters in payee name', () => {
        const url = generateUPIIntent('user@okaxis', 'Café & Bar', 100);
        // Ampersand must be encoded so it doesn't break query string parsing
        expect(url).not.toContain('pn=Café & Bar');
    });

    it('round-trips parameters correctly via URLSearchParams', () => {
        const url = generateUPIIntent('test@paytm', 'Bob Smith', 123.45, 'Lunch');
        const queryString = url.replace('upi://pay?', '');
        const params = new URLSearchParams(queryString);
        expect(params.get('pa')).toBe('test@paytm');
        expect(params.get('pn')).toBe('Bob Smith');
        expect(params.get('am')).toBe('123.45');
        expect(params.get('cu')).toBe('INR');
        expect(params.get('tn')).toBe('Lunch');
    });
});

// ---- isUPISupported ----------------------------------------------------------

describe('isUPISupported', () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
        // Restore navigator after each test
        Object.defineProperty(global, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        });
    });

    it('returns false when navigator is undefined (SSR)', () => {
        Object.defineProperty(global, 'navigator', {
            value: undefined,
            writable: true,
            configurable: true,
        });
        expect(isUPISupported()).toBe(false);
    });

    it('returns true for Android user agent', () => {
        Object.defineProperty(global, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 6)' },
            writable: true,
            configurable: true,
        });
        expect(isUPISupported()).toBe(true);
    });

    it('returns true for iPhone user agent', () => {
        Object.defineProperty(global, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)' },
            writable: true,
            configurable: true,
        });
        expect(isUPISupported()).toBe(true);
    });

    it('returns false for desktop Chrome user agent', () => {
        Object.defineProperty(global, 'navigator', {
            value: {
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
            },
            writable: true,
            configurable: true,
        });
        expect(isUPISupported()).toBe(false);
    });

    it('returns false for desktop Safari user agent', () => {
        Object.defineProperty(global, 'navigator', {
            value: {
                userAgent:
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 Safari/605.1.15',
            },
            writable: true,
            configurable: true,
        });
        expect(isUPISupported()).toBe(false);
    });
});

// ---- openUPIApp --------------------------------------------------------------

describe('openUPIApp', () => {
    it('does nothing when window is undefined (SSR)', () => {
        const originalWindow = global.window;
        try {
            // @ts-expect-error simulating SSR
            delete global.window;
            // Should not throw
            expect(() => openUPIApp('upi://pay?pa=x@y')).not.toThrow();
        } finally {
            global.window = originalWindow;
        }
    });

    it('sets window.location.href when UPI is supported', () => {
        Object.defineProperty(global, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (Linux; Android 12)' },
            writable: true,
            configurable: true,
        });
        // Mock window.location
        const originalLocation = global.window.location;
        const mockAssign = vi.fn();
        Object.defineProperty(global.window, 'location', {
            value: { href: '', assign: mockAssign },
            writable: true,
            configurable: true,
        });

        openUPIApp('upi://pay?pa=user@okaxis&am=100.00');
        expect(global.window.location.href).toBe('upi://pay?pa=user@okaxis&am=100.00');

        Object.defineProperty(global.window, 'location', {
            value: originalLocation,
            writable: true,
            configurable: true,
        });
    });
});
