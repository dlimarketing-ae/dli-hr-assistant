// Password hashing using the Web Crypto API (available natively in Cloudflare
// Workers/Pages Functions — no npm dependency needed). PBKDF2-SHA256, matching
// what migrations/0002_seed.sql was generated with.

const ITERATIONS = 100_000;
const HASH_BITS = 256; // 32 bytes

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt);
  return `${bufToHex(salt.buffer as ArrayBuffer)}:${bufToHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = hexToBuf(saltHex);
  const derived = await pbkdf2(password, salt);
  const derivedHex = bufToHex(derived);
  // constant-time-ish compare
  if (derivedHex.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return bufToHex(bytes.buffer as ArrayBuffer);
}
