// App-side pre-checks for lead actions (CONTRACT.md, "Lead actions"). n8n enforces the same rules again
// before writing; these give fast, plain-language feedback and keep obviously bad requests away from n8n.
import { checkDraft, checkFollowup, isSuppressed } from "../../shared/email/index.js";
import { FOLLOWUP_STAGES, isTestMode } from "./queues";
import { parseCountries } from "./types";
import type { LeadAction, LeadActionRequest, LeadRow, Role, Settings, SuppressionRow } from "./types";

export type RuleContext = {
  lead: LeadRow;
  settings: Settings;
  suppression: SuppressionRow[];
  role: Role;
  /** From /status; `undefined` when unknown (n8n checks again anyway). */
  wf3Running?: boolean;
};

export type RuleResult = { ok: true } | { ok: false; status: 403 | 422; errors: string[] };

const v = (x: unknown) => String(x ?? "").trim();
const isFollowupStage = (stage: string) => (FOLLOWUP_STAGES as readonly string[]).includes(stage);

export const ACTION_LABELS: Record<LeadAction, string> = {
  approve_first: "approve the first email",
  reject_first: "reject the first email",
  edit_first: "edit the first email",
  unapprove_first: "take back the approval",
  approve_followup: "approve the follow-up",
  edit_followup: "edit the follow-up",
  rewrite_followup: "ask for a follow-up rewrite",
  decline_followup: "decline the follow-up",
  opt_out: "mark the lead as opted out",
  set_reply_category: "change the reply category",
  mark_hot_handled: "mark the Hot reply as handled",
  reset_test_sent: "reset the test-sent lead to Drafted",
  close_test_sent: "close the test-sent lead",
};

export function checkLeadAction(req: Pick<LeadActionRequest, "action" | "data">, ctx: RuleContext): RuleResult {
  const { action, data } = req;
  const { lead, settings, suppression, role } = ctx;
  const stage = v(lead.Stage);
  const approved = v(lead.Approved);
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
  const notOptedOut = () => need(v(lead["Opt-out"]) !== "Yes", "This lead has opted out, so nothing can be sent to it.");
  const notSuppressed = () =>
    need(!(lead.Email && isSuppressed(lead.Email, suppression)), "This address or its domain is on the Suppression list, so nothing can be sent to it.");
  const drafted = () => need(stage === "Drafted", `This lead is no longer waiting for a first-email decision (its stage is now "${stage || "empty"}").`);
  const followupStage = () => {
    need(isFollowupStage(stage), `This lead has no follow-up waiting (its stage is now "${stage || "empty"}").`);
    need(v(lead["Follow-up Draft"]) !== "", "There is no follow-up draft on this lead any more.");
  };

  if (action === "reset_test_sent" || action === "close_test_sent") {
    if (role !== "admin") return { ok: false, status: 403, errors: ["Only the admin can clean up test-sent leads."] };
  }

  switch (action) {
    case "approve_first": {
      drafted();
      need(v(lead["Compliance Status"]) === "OK",
        `The draft's compliance status is "${v(lead["Compliance Status"]) || "empty"}"; only drafts marked OK can be approved. Edit the draft to re-check it.`);
      const c = checkDraft({ subject: lead.Subject, body: lead["Draft Body"], lead, settings, suppression });
      if (c.status !== "OK") errors.push(`The draft does not pass the checks: ${c.notes.join("; ")}.`);
      notOptedOut();
      notSuppressed();
      break;
    }
    case "reject_first":
      drafted();
      need(v(data.note) !== "", "Please give a reason for rejecting this draft.");
      break;
    case "edit_first":
      drafted();
      need(approved !== "Yes", "This draft is approved. Take back the approval before editing it.");
      need(typeof data.subject === "string" && v(data.subject) !== "", "The subject cannot be empty.");
      need(typeof data.body === "string" && v(data.body) !== "", "The email text cannot be empty.");
      break;
    case "unapprove_first":
      drafted();
      need(approved === "Yes", "This draft is not approved, so there is nothing to take back.");
      need(ctx.wf3Running !== true, "WF3 is sending right now and may already be sending this email. Wait until the run has finished.");
      break;
    case "approve_followup": {
      followupStage();
      const c = checkFollowup({ body: lead["Follow-up Draft"], lead, settings, suppression });
      if (!c.ok) errors.push(`The follow-up does not pass the checks: ${c.notes.join("; ")}.`);
      notOptedOut();
      notSuppressed();
      break;
    }
    case "edit_followup":
      followupStage();
      need(typeof data.body === "string" && v(data.body) !== "", "The follow-up text cannot be empty.");
      break;
    case "rewrite_followup":
      followupStage();
      need(v(data.note) !== "", "Please say what WF5 should change in the rewrite.");
      break;
    case "decline_followup":
      followupStage();
      break;
    case "opt_out":
      break;
    case "set_reply_category":
      need(v(lead["Reply Category"]) !== "", "This lead has no reply yet, so its category cannot be changed.");
      need(["Hot", "Warm", "Cold", "Not interested"].includes(v(data.category)), "Choose Hot, Warm, Cold or Not interested.");
      break;
    case "mark_hot_handled":
      need(v(lead["Reply Category"]) === "Hot", "Only Hot replies can be marked as handled.");
      break;
    case "reset_test_sent":
      need(isTestMode(settings), "Test mode is off (Settings > Test Email is empty), so this lead's email went to the real address and cannot be reset.");
      need(v(lead["Sent At"]) !== "", "This lead has not been sent anything, so there is nothing to reset.");
      break;
    case "close_test_sent":
      need(v(lead["Sent At"]) !== "", "This lead has not been sent anything, so there is nothing to close.");
      break;
    default: {
      const never: never = action;
      errors.push(`Unknown action ${String(never)}.`);
    }
  }
  return errors.length ? { ok: false, status: 422, errors } : { ok: true };
}

// ---- Settings ---------------------------------------------------------------

export const SETTINGS_ADMIN_ONLY = ["Test Email", "HubSpot Monthly Limit", "HubSpot Pause Percent", "Seed Email", "Seed Every", "Target Countries"] as const;
export const SETTINGS_READ_ONLY = ["Mail Provider", "SMTP From", "Sheet URL", "Nil WhatsApp", "WhatsApp Phone Number ID", "HubSpot Owner ID"] as const;
/** Fields that must not be empty after a save. */
export const SETTINGS_REQUIRED = ["Sender Name", "Company Legal Name", "Company Address", "Opt-out TR", "Opt-out EN", "Company Website"] as const;

export type SettingsFieldAccess = "edit" | "admin" | "readonly";

/** How a role may treat a Settings field (for locks in the UI). */
export function settingsFieldAccess(field: keyof Settings, role: Role): SettingsFieldAccess {
  if ((SETTINGS_READ_ONLY as readonly string[]).includes(field)) return "readonly";
  if ((SETTINGS_ADMIN_ONLY as readonly string[]).includes(field)) return role === "admin" ? "edit" : "readonly";
  return "edit";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Format checks per field; returns plain sentences. */
export function validateSettingsValues(data: Partial<Settings>): string[] {
  const errors: string[] = [];
  for (const [k, raw] of Object.entries(data) as [keyof Settings, string][]) {
    const val = String(raw ?? "").trim();
    if ((SETTINGS_REQUIRED as readonly string[]).includes(k) && !val) errors.push(`${k} cannot be empty.`);
    if (k === "Target Countries" && !val) errors.push("Pick at least one target country.");
    if (!val) continue;
    switch (k) {
      case "Nil Email": case "Test Email": case "Seed Email":
        if (!EMAIL_RE.test(val)) errors.push(`${k} must be one email address.`);
        break;
      case "HubSpot Monthly Limit":
        if (!/^\d+$/.test(val) || Number(val) < 1) errors.push("HubSpot Monthly Limit must be a whole number above 0.");
        break;
      case "HubSpot Pause Percent":
        if (!/^\d+$/.test(val) || Number(val) < 1 || Number(val) > 100) errors.push("HubSpot Pause Percent must be a whole number from 1 to 100.");
        break;
      case "Seed Every":
        if (!/^\d+$/.test(val) || Number(val) < 1) errors.push("Seed Every must be a whole number above 0.");
        break;
      case "Target Countries": {
        const pc = parseCountries(val);
        if (pc.unknown.length) errors.push(`Target Countries: unknown country ${pc.unknown.join(", ")}.`);
        break;
      }
      case "Nil Telegram Chat ID":
        if (!/^-?\d+$/.test(val)) errors.push("Nil Telegram Chat ID must be a number (group chats start with -).");
        break;
      case "Company Website":
        if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(val)) errors.push("Company Website must be a full address starting with https://.");
        break;
    }
  }
  return errors;
}

export type SettingsCheckInput = {
  data: Partial<Settings>;
  expect: Partial<Settings>;
  role: Role;
  /** Header X-Go-Live: confirm */
  goLiveConfirmed: boolean;
  /** Rows still on the go-live list (testSentList). */
  testSentCount: number;
};

/** Role rules + go-live rule + value checks for a Settings write. */
export function checkSettingsWrite(i: SettingsCheckInput): RuleResult {
  const fields = Object.keys(i.data) as (keyof Settings)[];
  if (!fields.length) return { ok: false, status: 422, errors: ["Nothing to save: no field was changed."] };
  const forbidden: string[] = [];
  const adminOnly: string[] = [];
  for (const f of fields) {
    const access = settingsFieldAccess(f, i.role);
    if (access === "readonly") {
      if ((SETTINGS_READ_ONLY as readonly string[]).includes(f)) forbidden.push(f);
      else adminOnly.push(f);
    }
  }
  if (forbidden.length) return { ok: false, status: 403, errors: [`${forbidden.join(", ")} cannot be changed from the dashboard (they must match the n8n setup).`] };
  if (adminOnly.length) return { ok: false, status: 403, errors: [`Only the admin can change ${adminOnly.join(", ")}.`] };
  for (const f of fields) {
    if (!(f in i.expect)) return { ok: false, status: 422, errors: [`The previous value of ${f} is missing from the request; reload the page and try again.`] };
  }

  if ("Test Email" in i.data && v(i.data["Test Email"]) === "") {
    if (!i.goLiveConfirmed) return { ok: false, status: 422, errors: ["Test Email can only be cleared through the Go-live flow."] };
    if (i.role !== "admin") return { ok: false, status: 403, errors: ["Only the admin can go live."] };
    if (i.testSentCount > 0) {
      return { ok: false, status: 422, errors: [`Go-live is blocked: ${i.testSentCount} lead(s) were sent in test mode and still need a decision (reset to Drafted or close).`] };
    }
  } else if (i.goLiveConfirmed) {
    return { ok: false, status: 422, errors: ["The go-live confirmation was sent without clearing Test Email."] };
  }
  const errors = validateSettingsValues(i.data);
  return errors.length ? { ok: false, status: 422, errors } : { ok: true };
}
