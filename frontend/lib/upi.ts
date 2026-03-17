/**
 * Generate UPI payment intent URL
 * @param hostVPA - Host's UPI VPA (e.g., "user@okaxis")
 * @param hostName - Host's name
 * @param amount - Amount to pay
 * @param note - Optional payment note
 * @returns UPI deep link URL
 */
const VPA_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;

export function isValidVPA(vpa: string): boolean {
    return VPA_REGEX.test(vpa);
}

export function generateUPIIntent(
    hostVPA: string,
    hostName: string,
    amount: number,
    note: string = "Bill Split Payment"
): string {
    // Validate VPA format to prevent URL injection (& in VPA breaks params)
    if (!isValidVPA(hostVPA)) {
        throw new Error(`Invalid UPI VPA format: ${hostVPA}`);
    }

    // Build UPI URL manually so @ in pa is never encoded as %40,
    // and spaces in other fields use %20 (not + from URLSearchParams).
    const pn = encodeURIComponent(hostName);
    const tn = encodeURIComponent(note);
    const am = amount.toFixed(2);

    return `upi://pay?pa=${hostVPA}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
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
