// Crypto utilities for Razorpay signature verification and secure hashing

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await hmacSha256Hex(secret, `${orderId}|${paymentId}`);
  return expectedSignature.toLowerCase() === signature.toLowerCase();
}

export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSecureToken(prefix = 'tok_'): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
