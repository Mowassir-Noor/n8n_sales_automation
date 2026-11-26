// Allowlists -> role. Pure; the lists come from env (APPROVER_EMAILS, ADMIN_EMAILS).
import type { Role } from "./types";

export type Allowlists = { approverEmails: readonly string[]; adminEmails: readonly string[] };

export function normaliseEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

/** Admin wins when an address is on both lists. `null` = not allowed to sign in. */
export function roleFor(email: string | null | undefined, lists: Allowlists): Role | null {
  const e = normaliseEmail(email);
  if (!e || !e.includes("@")) return null;
  if (lists.adminEmails.some((a) => normaliseEmail(a) === e)) return "admin";
  if (lists.approverEmails.some((a) => normaliseEmail(a) === e)) return "approver";
  return null;
}

export const ADMIN_ONLY_LEAD_ACTIONS = ["reset_test_sent", "close_test_sent"] as const;

export function canDoLeadAction(role: Role, action: string): boolean {
  if ((ADMIN_ONLY_LEAD_ACTIONS as readonly string[]).includes(action)) return role === "admin";
  return true;
}
