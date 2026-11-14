// Shared types for the dashboard. Field names are the exact Google Sheet headers,
// so a row object can travel from n8n to the browser without renaming.
// Owned by the integrator: change only together with dashboard/CONTRACT.md.

export const LEAD_HEADERS = [
  "Lead ID", "Company", "Website", "Country", "Segment",
  "Contact Name", "Contact Title", "Email", "LinkedIn",
  "Research Notes", "Personalisation Hook", "Language",
  "Compliance Status", "Compliance Notes",
  "Subject", "Draft Body", "Draft Body EN",
  "Approved", "Nil Notes", "Stage",
  "Sent At", "Gmail Thread ID", "Follow-up Count", "Next Follow-up Date",
  "Reply Category", "Reply Summary", "HubSpot Contact ID", "Opt-out",
  "Last Updated", "Source URL", "Source Date", "Confidence", "Follow-up Draft",
] as const; // A..AG (33 columns)

/** New column AH, added for the dashboard (plan, open question 3; assumed yes). */
export const HOT_HANDLED = "Hot Handled" as const;

export type LeadHeader = (typeof LEAD_HEADERS)[number] | typeof HOT_HANDLED;
export type LeadRow = { [K in LeadHeader]: string } & { row_number?: number };

export const SETTINGS_HEADERS = [
  "Sender Name", "Sender Title", "Company Legal Name", "Company Address",
  "Opt-out TR", "Opt-out EN", "Nil Email", "Sheet URL",
  "HubSpot Monthly Limit", "HubSpot Pause Percent", "Test Email",
  "Nil WhatsApp", "WhatsApp Phone Number ID", "Nil Telegram Chat ID",
  "Company Website", "HubSpot Owner ID", "Mail Provider", "SMTP From",
  "Seed Email", "Seed Every",
] as const; // A..T, row 2 only
export type SettingsHeader = (typeof SETTINGS_HEADERS)[number];
export type Settings = { [K in SettingsHeader]: string };

export type SuppressionRow = { Email: string; Domain: string; Reason: string; Date: string; row_number?: number };
export type SocialRow = { Week: string; Topic: string; Draft: string; Approved: string; "Nil Notes": string; Posted: string; row_number?: number };
export type LogRow = { Timestamp: string; Workflow: string; "Lead ID": string; Company: string; Step: string; Input: string; Output: string; Reason: string; row_number?: number };

export type ApprovedValue = "" | "Pending" | "Yes" | "No" | "Edit";
export type ComplianceStatus = "OK" | "Needs fix" | "Blocked" | "";

export type Snapshot = {
  ok: true;
  fetchedAt: string;            // ISO, set by n8n
  headersOk: boolean;           // Leads headers A..AG match LEAD_HEADERS exactly
  headerProblems: string[];     // human-readable, empty when headersOk
  leads: LeadRow[];
  settings: Settings;
  suppression: SuppressionRow[];
  social: SocialRow[];
};

export type Role = "approver" | "admin";
export type SessionUser = { email: string; name?: string; role: Role };

// ---- Writes -------------------------------------------------------------

export type LeadAction =
  | "approve_first" | "reject_first" | "edit_first" | "unapprove_first"
  | "approve_followup" | "edit_followup" | "rewrite_followup" | "decline_followup"
  | "opt_out" | "set_reply_category" | "mark_hot_handled"
  | "reset_test_sent" | "close_test_sent"; // go-live cleanup (phase 4, admin only)

/** The row as the user saw it. Any mismatch on re-read => 409, nothing written. */
export type Expect = {
  lastUpdated: string;   // "Last Updated" cell, compared as a string
  stage: string;
  approved: string;
  draftHash: string;     // first email: hashFirst(Subject, Draft Body); follow-up actions: hashFollowup(Follow-up Draft)
};

export type LeadActionRequest = {
  action: LeadAction;
  leadId: string;
  expect: Expect;
  data: {
    subject?: string;      // edit_first
    body?: string;         // edit_first, edit_followup
    note?: string;         // reject_first (reason), rewrite_followup (instructions), opt_out (reason)
    category?: "Hot" | "Warm" | "Cold" | "Not interested"; // set_reply_category
  };
  requestId: string;       // uuid from the browser; a repeat within 10 min returns the first result
};

/** What the app sends on to n8n: the browser request plus the signed-in user. */
export type N8nLeadActionRequest = LeadActionRequest & { actor: string; actorRole: Role };

export type WriteResult<T = LeadRow> =
  | { status: 200; ok: true; row: T }
  | { status: 409; conflict: true; row: T | null; message: string }
  | { status: 422; errors: string[] }
  | { status: 401 | 403; error: string }
  | { status: 500 | 502 | 503; error: string };

export type SettingsWriteRequest = {
  expect: Partial<Settings>;   // the before value of every field being changed
  data: Partial<Settings>;     // only changed fields
  requestId: string;
};

export type SuppressionWriteRequest =
  | { action: "add"; data: { Email?: string; Domain?: string; Reason: string }; requestId: string }
  | { action: "remove"; rowNumber: number; expect: { Email: string; Domain: string }; reason: string; requestId: string };

export type SocialWriteRequest = {
  rowNumber: number;
  expect: { Week: string; Topic: string; draftHash: string };
  data: { Approved?: "Pending" | "Yes" | "No" | "Edit"; "Nil Notes"?: string; Posted?: "Yes" | "No" };
  requestId: string;
};

export type LogQuery = { leadId?: string; workflow?: string; from?: string; to?: string; page?: number; pageSize?: number };
export type LogPage = { ok: true; rows: LogRow[]; total: number; page: number; pageSize: number };

export type ExecutionInfo = {
  workflowId: string; workflowName: string; status: string; // success | error | running | waiting | canceled
  startedAt: string; stoppedAt: string | null; error: string | null;
};
export type StatusResponse = { ok: true; executions: ExecutionInfo[]; running: { wf3: boolean; wf5: boolean } };

// ---- Appended by backend (additive only) ---------------------------------

/** GET /api/me: the SessionUser plus non-secret app config the UI needs. */
export type MeResponse = SessionUser & {
  config: {
    weeklyFirstEmailCap: number;   // WEEKLY_FIRST_EMAIL_CAP (soft warning)
    dailyWarmupCap: number;        // DAILY_WARMUP_CAP (soft warning)
    hubspotPortalId: string | null; // HUBSPOT_PORTAL_ID, enables "open in HubSpot" links
    sheetEnv: "live" | "staging";
  };
};

/** Error bodies the app adds on top of WriteResult: 429 rate limit (60 writes/min/user). */
export type RateLimited = { status: 429; error: string };
