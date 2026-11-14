// Claude (MCP) access keys. MCP_KEYS holds "email:sha256(key)" entries; the key itself is only ever shown
// once, by scripts/mcp-key.mjs. The email's role comes from ADMIN_EMAILS / APPROVER_EMAILS, as for sign-in.
import { createHash, timingSafeEqual } from "node:crypto";
import { roleFor, type Allowlists } from "../roles";
import type { SessionUser } from "../types";

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function parseMcpKeys(raw: string): { email: string; hash: string }[] {
  const out: { email: string; hash: string }[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const p = part.trim();
    const i = p.lastIndexOf(":");
    if (i <= 0) continue;
    const email = p.slice(0, i).trim().toLowerCase();
    const hash = p.slice(i + 1).trim().toLowerCase();
    if (email.includes("@") && /^[0-9a-f]{64}$/.test(hash)) out.push({ email, hash });
  }
  return out;
}

/** The user a key belongs to, with the role from the allowlists; null when the key or the role is unknown. */
export function userForKey(key: string | null | undefined, raw: string, lists: Allowlists): SessionUser | null {
  const k = String(key ?? "").trim();
  if (k.length < 20) return null;
  const h = Buffer.from(hashKey(k), "hex");
  let email: string | null = null;
  for (const e of parseMcpKeys(raw)) {
    if (timingSafeEqual(h, Buffer.from(e.hash, "hex"))) email = e.email;
  }
  if (!email) return null;
  const role = roleFor(email, lists);
  return role ? { email, role } : null;
}
