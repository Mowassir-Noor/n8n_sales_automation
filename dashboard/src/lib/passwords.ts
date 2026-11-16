// Email + password sign-in. Users live in the DASH_USERS env var as comma-separated
// "email:salt:hash" entries (base64url scrypt, made by scripts/hash-password.mjs), so no
// database and no plain-text passwords. Roles still come from APPROVER_EMAILS / ADMIN_EMAILS.
import { scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const PARAMS = { N: 16384, r: 8, p: 1 };

export type PasswordEntry = { salt: Buffer; hash: Buffer };

export function parseDashUsers(raw: string): Map<string, PasswordEntry> {
  const out = new Map<string, PasswordEntry>();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const [email, salt, hash] = t.split(":");
    if (!email || !salt || !hash) continue;
    out.set(email.trim().toLowerCase(), {
      salt: Buffer.from(salt, "base64url"),
      hash: Buffer.from(hash, "base64url"),
    });
  }
  return out;
}

export function verifyPassword(password: string, entry: PasswordEntry): boolean {
  if (entry.hash.length !== KEYLEN) return false;
  const got = scryptSync(password, entry.salt, KEYLEN, PARAMS);
  return timingSafeEqual(got, entry.hash);
}

// Brute-force brake: 8 failed attempts per email in 15 minutes locks that email for the rest of the window.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
type Fails = { count: number; first: number };
const g = globalThis as unknown as { __dashLoginFails?: Map<string, Fails> };
const fails = (g.__dashLoginFails ??= new Map<string, Fails>());

export function isLocked(email: string, now = Date.now()): boolean {
  const f = fails.get(email);
  if (!f) return false;
  if (now - f.first > WINDOW_MS) {
    fails.delete(email);
    return false;
  }
  return f.count >= MAX_FAILS;
}

export function recordFailure(email: string, now = Date.now()) {
  const f = fails.get(email);
  if (!f || now - f.first > WINDOW_MS) fails.set(email, { count: 1, first: now });
  else f.count += 1;
}

export function clearFailures(email: string) {
  fails.delete(email);
}
