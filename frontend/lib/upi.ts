/**
 * Generate UPI payment intent URL
 * @param hostVPA - Host's UPI VPA (e.g., "user@okaxis")
 * @param hostName - Host's name
 * @param amount - Amount to pay
 * @param note - Optional payment note
 * @returns UPI deep link URL
 */
export function generateUPIIntent(
    hostVPA: string,
    hostName: string,
    amount: number,
    note: string = "Bill Split Payment"
): string {
    // Format amount to 2 decimal places
    const formattedAmount = amount.toFixed(2);

    // Encode parameters
    const params = new URLSearchParams({
        pa: hostVPA,
        pn: hostName,
        am: formattedAmount,
        cu: 'INR',
        tn: note
    });

    return `upi://pay?${params.toString()}`;
}

/**
 * Check if UPI is supported on this device
 * @returns boolean indicating UPI support
 */
export function isUPISupported(): boolean {
    // UPI links only work on mobile devices
    if (typeof navigator === 'undefined') return false;

    const userAgent = navigator.userAgent || navigator.vendor;
    const isMobile = /android|iphone|ipad|ipod/i.test(userAgent);

    return isMobile;
}

/**
 * Open UPI payment app
 * @param upiUrl - The UPI deep link
 */
export function openUPIApp(upiUrl: string): void {
    if (typeof window === 'undefined') return;

    if (isUPISupported()) {
        window.location.href = upiUrl;
    } else {
        // Fallback: show QR code or copy link
        console.warn('UPI not supported on this device');
    }
}
