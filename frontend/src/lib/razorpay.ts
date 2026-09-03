/**
 * Razorpay Checkout script loader.
 *
 * The checkout page previously branched on `window.Razorpay` while nothing ever loaded the
 * SDK, so that check was always false and every payment silently took the simulated path.
 * The script is loaded on demand rather than in index.html, so the public booking pages that
 * never reach checkout do not pay for it.
 */

const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let loader: Promise<boolean> | null = null;

export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if ((window as any).Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean((window as any).Razorpay)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve(Boolean((window as any).Razorpay));
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      loader = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return loader;
}
