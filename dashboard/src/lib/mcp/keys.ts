// Claude (MCP) connector keys. Each person's key is derived from their email and a server secret
// (MCP_SECRET, or AUTH_SECRET when that is empty), so nothing is stored: a signed-in person sees their own
// connector URL on the "Connect Claude" page. The role still comes from ADMIN_EMAILS / APPROVER_EMAILS, so
// taking someone off the allowlists also stops their key. Changing the secret replaces every key.
import { createHmac, timingSafeEqual } from "node:crypto";
import { roleFor, type Allowlists } from "../roles";
import type { SessionUser } from "../types";

const LABEL = "texprove-dashboard-mcp-v1:";

/** The connector key for an email, or null when the connector is off (no secret). */
export function keyFor(email: string, secret: string): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(LABEL + email.trim().toLowerCase(), "utf8").digest("base64url");
}

/** The user a key belongs to, with the role from the allowlists; null when the key or the role is unknown. */
export function userForKey(key: string | null | undefined, secret: string, lists: Allowlists): SessionUser | null {
  const k = Buffer.from(String(key ?? "").trim(), "utf8");
  if (!secret || k.length < 20) return null;
  let email: string | null = null;
  for (const e of new Set([...lists.adminEmails, ...lists.approverEmails].map((x) => x.trim().toLowerCase()))) {
    const want = Buffer.from(keyFor(e, secret) ?? "", "utf8");
    if (want.length === k.length && timingSafeEqual(want, k)) email = e;
  }
  if (!email) return null;
  const role = roleFor(email, lists);
  return role ? { email, role } : null;
}
