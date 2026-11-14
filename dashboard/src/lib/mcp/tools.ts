// MCP tools: everything the dashboard can do, for Claude. Each tool reads the sheet through the same
// n8n snapshot and writes through the same checks as the page (lib/writes.ts), as the key's user and role.
import { randomUUID } from "node:crypto";
import { checkDraft, checkFollowup, hashText, recipientFor } from "@shared/email";
import { expectFor } from "../expect";
import { getLog, getStatus } from "../n8n";
import {
  capStatus, findLead, firstEmailQueue, followupNumber, followupTab, homeCounts, hotList, isTestMode,
  nextFirstEmailRun, nextFollowupRun, pipelineCounts, replyList, testSentList,
} from "../queues";
import { SETTINGS_ADMIN_ONLY, SETTINGS_READ_ONLY } from "../rules";
import { readSnapshot } from "../snapshot";
import { env } from "../env";
import { SETTINGS_HEADERS, TARGET_COUNTRIES, type LeadAction, type LeadRow, type SessionUser, type Settings, type Snapshot } from "../types";
import { leadActionWrite, settingsWrite, socialWrite, suppressionWrite } from "../writes";
import { leadActionSchema, logQuerySchema, settingsWriteSchema, socialWriteSchema, suppressionWriteSchema } from "../schemas";

export type ToolResult = { ok: boolean; data: unknown };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
  run: (user: SessionUser, args: Record<string, unknown>) => Promise<ToolResult>;
};

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (message: string | string[], extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, data: { error: message, ...extra } });

async function snapshot(fresh = true): Promise<{ snap: Snapshot } | { error: ToolResult }> {
  const r = await readSnapshot({ fresh });
  if (r.status !== 200) return { error: fail("Cannot read the sheet through n8n right now: " + r.body.error) };
  if (r.body.stale) return { error: fail("n8n is not answering, so only an old copy of the sheet is available. Try again in a minute.") };
  return { snap: r.body };
}

/** Turns a write Response into a tool result. */
async function fromResponse(res: Response): Promise<ToolResult> {
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  if (res.status === 200) return ok(body);
  const msg = (body.errors as string[] | undefined) ?? (body.message as string | undefined) ?? (body.error as string | undefined) ?? `Failed (HTTP ${res.status})`;
  return fail(msg, { status: res.status });
}

const str = (v: unknown) => (v == null ? "" : String(v));

function summary(l: LeadRow) {
  return {
    leadId: l["Lead ID"], company: l.Company, country: l.Country, language: l.Language, stage: l.Stage,
    approved: l.Approved, compliance: l["Compliance Status"], subject: l.Subject, contact: l["Contact Name"],
    email: l.Email, replyCategory: l["Reply Category"] || undefined, followupDraft: l["Follow-up Draft"] ? `follow-up ${followupNumber(l)} waiting` : undefined,
    lastUpdated: l["Last Updated"],
  };
}

const VIEWS = [
  "first_emails_waiting", "first_emails_approved", "first_emails_rejected",
  "followups_waiting", "followups_all", "replies", "hot", "test_sent", "all",
] as const;

function selectView(snap: Snapshot, view: (typeof VIEWS)[number]): LeadRow[] {
  const q = firstEmailQueue(snap.leads);
  switch (view) {
    case "first_emails_waiting": return q.waiting;
    case "first_emails_approved": return q.approved;
    case "first_emails_rejected": return q.rejected;
    case "followups_waiting": return snap.leads.filter((l) => followupTab(l) === "waiting");
    case "followups_all": return snap.leads.filter((l) => followupTab(l) !== null);
    case "replies": return replyList(snap.leads);
    case "hot": return hotList(snap.leads);
    case "test_sent": return testSentList(snap.leads, snap.settings);
    default: return snap.leads;
  }
}

/** Same rule as the page's "Approve all": OK in the sheet and on the live re-check, not marked Edit, not opted out. */
function firstEmailEligible(snap: Snapshot, l: LeadRow): string[] {
  const why: string[] = [];
  if (l["Compliance Status"] !== "OK") why.push(`Compliance Status is "${l["Compliance Status"]}"`);
  if (l.Approved === "Edit") why.push("marked for edit");
  if ((l["Opt-out"] || "").trim() === "Yes") why.push("opted out");
  const c = checkDraft({ subject: l.Subject, body: l["Draft Body"], lead: l, settings: snap.settings, suppression: snap.suppression });
  if (c.status !== "OK") why.push(...c.notes);
  return why;
}

function followupEligible(snap: Snapshot, l: LeadRow): string[] {
  const why: string[] = [];
  if ((l["Opt-out"] || "").trim() === "Yes") why.push("opted out");
  const c = checkFollowup({ body: l["Follow-up Draft"], lead: l, settings: snap.settings, suppression: snap.suppression });
  if (!c.ok) why.push(...c.notes);
  return why;
}

async function runLeadAction(user: SessionUser, lead: LeadRow, action: LeadAction, data: Record<string, unknown>): Promise<ToolResult> {
  const parsed = leadActionSchema.safeParse({ action, leadId: lead["Lead ID"], expect: expectFor(lead, action), data, requestId: randomUUID() });
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return fromResponse(await leadActionWrite(user, parsed.data));
}

const ACTION_HELP = [
  "approve_first: approve the first email (Stage Drafted); WF3 sends it at its next run (weekdays 10:00 and 14:00 Istanbul).",
  "reject_first: reject the first email; needs note.",
  "edit_first: replace subject and body of a first email (re-checked; Approved goes back to Pending); needs subject and body.",
  "unapprove_first: take back an approval before WF3 sends it.",
  "approve_followup / decline_followup: approve or decline the waiting follow-up.",
  "edit_followup: replace the follow-up text; needs body.",
  "rewrite_followup: ask WF5 to rewrite the follow-up with instructions; needs note.",
  "opt_out: stop all contact and add the email to Suppression; needs note (the reason).",
  "set_reply_category: correct the reply classification; needs category (Hot, Warm, Cold, Not interested).",
  "mark_hot_handled: mark a Hot reply as handled.",
  "reset_test_sent / close_test_sent (admin): go-live clean-up of leads that were sent to the test inbox.",
].join("\n");

export const TOOLS: Tool[] = [
  {
    name: "overview",
    description: "Start here. Counts of what is waiting (first emails, follow-ups, Hot replies), test mode, target countries, this week's sends against the caps, pipeline by stage, next send runs, and your role.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (user) => {
      const s = await snapshot(false);
      if ("error" in s) return s.error;
      const { snap } = s;
      const e = env();
      const now = new Date();
      return ok({
        you: { email: user.email, role: user.role },
        testMode: isTestMode(snap.settings) ? `ON: every email goes to ${snap.settings["Test Email"]}, not to leads` : "OFF: emails go to the real leads",
        targetCountries: snap.settings["Target Countries"] || "Turkey",
        waiting: homeCounts(snap.leads, snap.settings),
        caps: capStatus(snap.leads, { weekly: e.weeklyFirstEmailCap, daily: e.dailyWarmupCap }, now),
        pipeline: pipelineCounts(snap.leads),
        nextFirstEmailRun: nextFirstEmailRun(now).toISOString(),
        nextFollowupRun: nextFollowupRun(now).toISOString(),
        sheetHeadersOk: snap.headersOk,
      });
    },
  },
  {
    name: "list_leads",
    description: "List leads as short rows. view picks the list (default first_emails_waiting). Optional filters: country, stage, search (company, email or Lead ID). Use get_lead for the full email text.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: [...VIEWS] },
        country: { type: "string" },
        stage: { type: "string" },
        search: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    run: async (_user, a) => {
      const s = await snapshot(false);
      if ("error" in s) return s.error;
      const view = (VIEWS as readonly string[]).includes(str(a.view)) ? (a.view as (typeof VIEWS)[number]) : "first_emails_waiting";
      let rows = selectView(s.snap, view);
      if (a.country) rows = rows.filter((l) => l.Country.toLowerCase() === str(a.country).toLowerCase());
      if (a.stage) rows = rows.filter((l) => l.Stage.toLowerCase() === str(a.stage).toLowerCase());
      if (a.search) {
        const q = str(a.search).toLowerCase();
        rows = rows.filter((l) => [l["Lead ID"], l.Company, l.Email].some((v) => v.toLowerCase().includes(q)));
      }
      const limit = Math.min(500, Math.max(1, Number(a.limit) || 50));
      return ok({ view, total: rows.length, leads: rows.slice(0, limit).map(summary) });
    },
  },
  {
    name: "get_lead",
    description: "Everything about one lead: the full first email (and its English copy for Turkish drafts), the waiting follow-up, research notes, compliance notes, reply summary, who the email will really go to (test mode), and a live re-check of the draft.",
    inputSchema: { type: "object", properties: { leadId: { type: "string" } }, required: ["leadId"], additionalProperties: false },
    run: async (_user, a) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const lead = findLead(s.snap.leads, str(a.leadId));
      if (!lead) return fail(`Lead ${str(a.leadId)} is not in the sheet.`);
      const { snap } = s;
      const draft = lead["Draft Body"] ? checkDraft({ subject: lead.Subject, body: lead["Draft Body"], lead, settings: snap.settings, suppression: snap.suppression }) : null;
      const fu = lead["Follow-up Draft"] ? checkFollowup({ body: lead["Follow-up Draft"], lead, settings: snap.settings, suppression: snap.suppression }) : null;
      return ok({
        lead,
        sendsTo: recipientFor(lead, snap.settings),
        liveCheck: {
          firstEmail: draft ? { status: draft.status, notes: draft.notes } : null,
          followup: fu ? { ok: fu.ok, notes: fu.notes, number: followupNumber(lead) } : null,
        },
      });
    },
  },
  {
    name: "lead_action",
    description: "Change one lead, with the same checks as the dashboard buttons. Actions:\n" + ACTION_HELP,
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" },
        action: { type: "string", enum: [...leadActionSchema.shape.action.options] },
        subject: { type: "string", description: "edit_first" },
        body: { type: "string", description: "edit_first, edit_followup" },
        note: { type: "string", description: "reject_first, rewrite_followup, opt_out" },
        category: { type: "string", enum: ["Hot", "Warm", "Cold", "Not interested"], description: "set_reply_category" },
      },
      required: ["leadId", "action"],
      additionalProperties: false,
    },
    run: async (user, a) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const lead = findLead(s.snap.leads, str(a.leadId));
      if (!lead) return fail(`Lead ${str(a.leadId)} is not in the sheet.`);
      const data: Record<string, unknown> = {};
      for (const k of ["subject", "body", "note", "category"]) if (a[k] !== undefined) data[k] = a[k];
      return runLeadAction(user, lead, a.action as LeadAction, data);
    },
  },
  {
    name: "approve_all",
    description: "Approve every waiting item that passes all checks, like the dashboard's \"Approve all\" button. kind: first_emails or followups. Returns what was approved and what was skipped and why.",
    write: true,
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["first_emails", "followups"] } }, required: ["kind"], additionalProperties: false },
    run: async (user, a) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const { snap } = s;
      const first = a.kind !== "followups";
      const waiting = first ? firstEmailQueue(snap.leads).waiting : snap.leads.filter((l) => followupTab(l) === "waiting");
      const approved: string[] = [];
      const skipped: { leadId: string; why: unknown }[] = [];
      for (const l of waiting) {
        const why = first ? firstEmailEligible(snap, l) : followupEligible(snap, l);
        if (why.length) { skipped.push({ leadId: l["Lead ID"], why }); continue; }
        const r = await runLeadAction(user, l, first ? "approve_first" : "approve_followup", {});
        if (r.ok) approved.push(l["Lead ID"]);
        else skipped.push({ leadId: l["Lead ID"], why: (r.data as { error: unknown }).error });
      }
      return ok({ approved, skipped, note: approved.length ? (first ? "WF3 sends approved first emails at its next run." : "WF5 sends approved follow-ups at its next run.") : undefined });
    },
  },
  {
    name: "get_settings",
    description: "The Settings row (sender, signature, notification targets, Test Email / test mode, HubSpot limits, seed copy, Target Countries) and which fields your role may change.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (user) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      return ok({
        settings: s.snap.settings,
        readOnly: SETTINGS_READ_ONLY,
        adminOnly: SETTINGS_ADMIN_ONLY,
        yourRole: user.role,
        targetCountriesChoices: TARGET_COUNTRIES,
      });
    },
  },
  {
    name: "update_settings",
    description: "Change Settings fields. changes maps field names (as in get_settings) to new text. Target Countries is a comma-separated list of: " + TARGET_COUNTRIES.join(", ") + ". Clearing Test Email is going live (real leads get emails): it needs confirmGoLive true, the admin role, and no test-sent leads left; only do it when the user clearly asked to go live.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        changes: { type: "object", additionalProperties: { type: "string" } },
        confirmGoLive: { type: "boolean" },
      },
      required: ["changes"],
      additionalProperties: false,
    },
    run: async (user, a) => {
      const changes = (a.changes ?? {}) as Record<string, unknown>;
      const unknown = Object.keys(changes).filter((k) => !(SETTINGS_HEADERS as readonly string[]).includes(k));
      if (unknown.length) return fail(`Unknown Settings field(s): ${unknown.join(", ")}`);
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const data: Record<string, string> = {};
      const expect: Record<string, string> = {};
      for (const [k, v] of Object.entries(changes)) {
        data[k] = str(v);
        expect[k] = s.snap.settings[k as keyof Settings] ?? "";
      }
      const parsed = settingsWriteSchema.safeParse({ data, expect, requestId: randomUUID() });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      return fromResponse(await settingsWrite(user, parsed.data, a.confirmGoLive === true));
    },
  },
  {
    name: "list_suppression",
    description: "The Suppression tab: emails and domains that must never be contacted, with row numbers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const s = await snapshot(false);
      if ("error" in s) return s.error;
      return ok({ rows: s.snap.suppression });
    },
  },
  {
    name: "add_suppression",
    description: "Add an email address or a whole domain (one of them) to Suppression, with a reason.",
    write: true,
    inputSchema: { type: "object", properties: { email: { type: "string" }, domain: { type: "string" }, reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
    run: async (user, a) => {
      const parsed = suppressionWriteSchema.safeParse({
        action: "add",
        data: { ...(a.email ? { Email: str(a.email) } : {}), ...(a.domain ? { Domain: str(a.domain) } : {}), Reason: str(a.reason) },
        requestId: randomUUID(),
      });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message));
      return fromResponse(await suppressionWrite(user, parsed.data));
    },
  },
  {
    name: "remove_suppression",
    description: "Admin only: remove one Suppression row (row number from list_suppression), with a reason.",
    write: true,
    inputSchema: { type: "object", properties: { rowNumber: { type: "integer", minimum: 2 }, reason: { type: "string" } }, required: ["rowNumber", "reason"], additionalProperties: false },
    run: async (user, a) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const row = s.snap.suppression.find((r) => r.row_number === Number(a.rowNumber));
      if (!row) return fail(`No Suppression row ${str(a.rowNumber)}.`);
      const parsed = suppressionWriteSchema.safeParse({
        action: "remove", rowNumber: Number(a.rowNumber), expect: { Email: row.Email, Domain: row.Domain }, reason: str(a.reason), requestId: randomUUID(),
      });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message));
      return fromResponse(await suppressionWrite(user, parsed.data));
    },
  },
  {
    name: "list_social",
    description: "The Social tab: weekly LinkedIn post drafts with their approval state and row numbers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const s = await snapshot(false);
      if ("error" in s) return s.error;
      return ok({ rows: s.snap.social });
    },
  },
  {
    name: "update_social",
    description: "Set Approved (Pending, Yes, No, Edit), Nil Notes and/or Posted (Yes, No) on one Social row.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        rowNumber: { type: "integer", minimum: 2 },
        approved: { type: "string", enum: ["Pending", "Yes", "No", "Edit"] },
        nilNotes: { type: "string" },
        posted: { type: "string", enum: ["Yes", "No"] },
      },
      required: ["rowNumber"],
      additionalProperties: false,
    },
    run: async (user, a) => {
      const s = await snapshot(true);
      if ("error" in s) return s.error;
      const row = s.snap.social.find((r) => r.row_number === Number(a.rowNumber));
      if (!row) return fail(`No Social row ${str(a.rowNumber)}.`);
      const data: Record<string, string> = {};
      if (a.approved !== undefined) data.Approved = str(a.approved);
      if (a.nilNotes !== undefined) data["Nil Notes"] = str(a.nilNotes);
      if (a.posted !== undefined) data.Posted = str(a.posted);
      const parsed = socialWriteSchema.safeParse({
        rowNumber: Number(a.rowNumber), expect: { Week: row.Week, Topic: row.Topic, draftHash: hashText(row.Draft) }, data, requestId: randomUUID(),
      });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message));
      return fromResponse(await socialWrite(user, parsed.data));
    },
  },
  {
    name: "get_log",
    description: "The decision log (Log tab), newest first. Filters: leadId, workflow (e.g. WF3, Dashboard), from / to (yyyy-MM-dd), page, pageSize (max 200).",
    inputSchema: {
      type: "object",
      properties: {
        leadId: { type: "string" }, workflow: { type: "string" }, from: { type: "string" }, to: { type: "string" },
        page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: async (_user, a) => {
      const parsed = logQuerySchema.safeParse(a);
      if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      const q = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== ""));
      const r = await getLog({ page: 1, pageSize: 50, ...q });
      return r.status === 200 ? ok(r) : fail("error" in r ? r.error : "Could not read the log.");
    },
  },
  {
    name: "get_status",
    description: "Recent runs of the automation workflows WF0 to WF6 (success or error, with error messages) and whether WF3 or WF5 is sending right now.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const r = await getStatus();
      return r.status === 200 ? ok(r) : fail("error" in r ? r.error : "n8n is not reachable.");
    },
  },
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}
