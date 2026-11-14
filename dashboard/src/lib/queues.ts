// Pure queue derivation and schedule maths, shared by pages, API routes, the mock and tests.
// No I/O, no env access: pass `now` and caps in.
import type { LeadRow, Settings, ApprovedValue } from "./types";

export const TZ = "Europe/Istanbul";

// ---- Stages ---------------------------------------------------------------

/** Main path first, then side exits (docs/google-sheet.md, "Stage values"). */
export const STAGES = [
  "New", "Researched", "Drafted", "Sent", "Follow-up 1", "Follow-up 2", "Follow-up 3", "Closed - No reply",
  "Research failed", "Blocked - Compliance", "Replied - Hot", "Replied - Warm", "Replied - Cold", "Opted out",
] as const;
export type Stage = (typeof STAGES)[number];

export const FOLLOWUP_STAGES = ["Sent", "Follow-up 1", "Follow-up 2"] as const;

const s = (v: unknown) => String(v ?? "").trim();

// ---- First-email queue ----------------------------------------------------

export type FirstEmailTab = "waiting" | "approved" | "rejected";

/** Which tab of the first-email queue a row belongs to, or null when it is not in the queue. */
export function firstEmailTab(lead: LeadRow): FirstEmailTab | null {
  if (s(lead.Stage) !== "Drafted") return null;
  const a = s(lead.Approved) as ApprovedValue;
  if (a === "Yes") return "approved";
  if (a === "No") return "rejected";
  if (a === "" || a === "Pending" || a === "Edit") return "waiting";
  return "waiting"; // unknown value typed by hand: treat as not approved
}

export function firstEmailQueue(leads: readonly LeadRow[]): Record<FirstEmailTab, LeadRow[]> {
  const out: Record<FirstEmailTab, LeadRow[]> = { waiting: [], approved: [], rejected: [] };
  for (const l of leads) {
    const t = firstEmailTab(l);
    if (t) out[t].push(l);
  }
  return out;
}

// ---- Follow-up queue ------------------------------------------------------

export function isFollowupPending(lead: LeadRow): boolean {
  return (FOLLOWUP_STAGES as readonly string[]).includes(s(lead.Stage)) && s(lead["Follow-up Draft"]) !== "";
}

/** Follow-up Count + 1 (1, 2 or 3). */
export function followupNumber(lead: LeadRow): number {
  const n = Number(s(lead["Follow-up Count"]) || 0);
  return (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0) + 1;
}

export type FollowupTab = "waiting" | "approved" | "rewrite" | "declined";

export function followupTab(lead: LeadRow): FollowupTab | null {
  if (!isFollowupPending(lead)) return null;
  const a = s(lead.Approved);
  if (a === "Yes") return "approved";
  if (a === "Edit") return "rewrite";
  if (a === "No") return "declined";
  return "waiting";
}

export function followupQueue(leads: readonly LeadRow[]): LeadRow[] {
  return leads.filter(isFollowupPending);
}

// ---- Replies / Hot --------------------------------------------------------

export function isHot(lead: LeadRow): boolean {
  return s(lead["Reply Category"]) === "Hot" && s(lead["Hot Handled"]) === "";
}

/** Unhandled Hot replies, newest Last Updated first. */
export function hotList(leads: readonly LeadRow[]): LeadRow[] {
  return leads.filter(isHot).sort(byLastUpdatedDesc);
}

/** Every row with a Reply Category; unhandled Hot pinned first, then newest first. */
export function replyList(leads: readonly LeadRow[]): LeadRow[] {
  return leads
    .filter((l) => s(l["Reply Category"]) !== "")
    .sort((a, b) => Number(isHot(b)) - Number(isHot(a)) || byLastUpdatedDesc(a, b));
}

export function byLastUpdatedDesc(a: LeadRow, b: LeadRow): number {
  const ta = Date.parse(s(a["Last Updated"])) || 0;
  const tb = Date.parse(s(b["Last Updated"])) || 0;
  return tb - ta;
}

// ---- Test mode / go-live --------------------------------------------------

export function isTestMode(settings: Partial<Settings> | null | undefined): boolean {
  return s(settings?.["Test Email"]) !== "";
}

export type TestModeBanner = { on: false } | { on: true; address: string; message: string };

export function testModeBanner(settings: Partial<Settings> | null | undefined): TestModeBanner {
  const address = s(settings?.["Test Email"]);
  if (!address) return { on: false };
  return { on: true, address, message: `TEST MODE: all emails go to ${address}, not to leads` };
}

/**
 * Go-live list: while Test Email is set, rows whose first email went to the test address
 * (Sent At set) and that are not finished. Must be empty before Test Email can be cleared.
 */
export function testSentList(leads: readonly LeadRow[], settings: Partial<Settings> | null | undefined): LeadRow[] {
  if (!isTestMode(settings)) return [];
  return leads.filter(
    (l) => s(l["Sent At"]) !== "" && !["Opted out", "Closed - No reply"].includes(s(l.Stage)),
  );
}

// ---- Istanbul time helpers ------------------------------------------------

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric", weekday: "short",
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts in Istanbul. weekday: 0 = Sunday … 6 = Saturday. */
export function istanbulParts(d: Date): ZonedParts & { second: number } {
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WEEKDAYS[p.weekday] ?? 0,
  };
}

/** Offset of Istanbul from UTC at instant `d`, in minutes (180 since 2016). */
function offsetMinutes(d: Date): number {
  const p = istanbulParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which Istanbul's wall clock shows the given date and time. */
export function istanbulTime(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - offsetMinutes(guess) * 60000);
}

/** Start (00:00 Istanbul) of the day containing `now`. */
export function startOfIstanbulDay(now: Date): Date {
  const p = istanbulParts(now);
  return istanbulTime(p.year, p.month, p.day);
}

/** Start (Monday 00:00 Istanbul) of the week containing `now`. */
export function startOfIstanbulWeek(now: Date): Date {
  const p = istanbulParts(now);
  const back = (p.weekday + 6) % 7; // days since Monday
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return istanbulTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

/** "Mon 17 Nov, 10:00" in Istanbul time. */
export function formatIstanbul(d: Date, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(d);
}

// ---- Schedules ------------------------------------------------------------

export type ScheduleKey = "wf0" | "wf1" | "wf2" | "wf3" | "wf5" | "wf6";

/** Cron schedules of the workflows (Europe/Istanbul), from the WF*.json exports. WF4 polls every 15 min. */
export const SCHEDULES: Record<ScheduleKey, { name: string; days: readonly number[]; times: readonly [number, number][] }> = {
  wf0: { name: "WF0 - Company discovery", days: [1], times: [[7, 0]] },
  wf1: { name: "WF1 - Lead research", days: [1, 2, 3, 4, 5], times: [[8, 0]] },
  wf2: { name: "WF2 - Compliance check and draft", days: [1, 2, 3, 4, 5], times: [[9, 0]] },
  wf3: { name: "WF3 - Send approved emails", days: [1, 2, 3, 4, 5], times: [[10, 0], [14, 0]] },
  wf5: { name: "WF5 - Follow-ups", days: [1, 2, 3, 4, 5], times: [[11, 0]] },
  wf6: { name: "WF6 - Weekly report and LinkedIn drafts", days: [1], times: [[8, 30]] },
};

/** The next scheduled run strictly after `now`. WF3: weekdays 10:00 and 14:00; WF5: weekdays 11:00. */
export function nextRun(key: ScheduleKey, now: Date = new Date()): Date {
  const sched = SCHEDULES[key];
  const p = istanbulParts(now);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    if (!sched.days.includes(day.getUTCDay())) continue;
    for (const [h, m] of sched.times) {
      const t = istanbulTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m);
      if (t.getTime() > now.getTime()) return t;
    }
  }
  throw new Error("unreachable: no run within 8 days");
}

/** Next WF3 run (first emails): weekdays 10:00 and 14:00 Istanbul. */
export const nextFirstEmailRun = (now: Date = new Date()) => nextRun("wf3", now);
/** Next WF5 run (follow-ups): weekdays 11:00 Istanbul. */
export const nextFollowupRun = (now: Date = new Date()) => nextRun("wf5", now);

// ---- HubSpot usage estimate (port of WF3 'HubSpot Quota Check') -------------

export type HubspotUsage = {
  used: number; limit: number; percent: number; pauseAt: number; paused: boolean;
  detail: { firstEmails: number; followUps: number; replies: number };
};

/**
 * Same counting rule as WF3's 'HubSpot Quota Check' Code node (UTC calendar month):
 * first email = 2, each follow-up = 1 (dated Sent At + 4/10/20 days), each reply = 2 (by Last Updated).
 */
export function hubspotUsage(leads: readonly LeadRow[], settings: Partial<Settings> | null | undefined, now: Date = new Date()): HubspotUsage {
  const rows = leads.filter((r) => r && r["Lead ID"]);
  const limit = Number(settings?.["HubSpot Monthly Limit"]) || 3000;
  const pauseAt = Number(settings?.["HubSpot Pause Percent"]) || 80;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const inMonth = (d: string | Date) => { const t = new Date(d); return !isNaN(t.getTime()) && t.getUTCFullYear() === y && t.getUTCMonth() === m; };
  const addDays = (d: string, n: number) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() + n); return t; };
  const offsets = [4, 10, 20];
  let used = 0;
  const detail = { firstEmails: 0, followUps: 0, replies: 0 };
  for (const r of rows) {
    const sentAt = r["Sent At"];
    const sentValid = Boolean(sentAt) && !isNaN(new Date(sentAt).getTime());
    if (sentValid && inMonth(sentAt)) { used += 2; detail.firstEmails++; }
    const fu = Math.min(Number(r["Follow-up Count"] || 0), 3);
    if (sentValid) {
      for (let k = 0; k < fu; k++) {
        if (inMonth(addDays(sentAt, offsets[k]))) { used += 1; detail.followUps++; }
      }
    }
    if (String(r["Reply Category"] || "") !== "" && inMonth(r["Last Updated"])) { used += 2; detail.replies++; }
  }
  const percent = Math.round((used / limit) * 100);
  return { used, limit, percent, pauseAt, paused: percent >= pauseAt, detail };
}

// ---- Soft caps ------------------------------------------------------------

function sentBetween(leads: readonly LeadRow[], from: Date, to: Date): number {
  let n = 0;
  for (const l of leads) {
    const t = Date.parse(s(l["Sent At"]));
    if (!isNaN(t) && t >= from.getTime() && t < to.getTime()) n++;
  }
  return n;
}

/** First emails sent (Sent At) since Monday 00:00 Istanbul. */
export function firstEmailsThisWeek(leads: readonly LeadRow[], now: Date = new Date()): number {
  return sentBetween(leads, startOfIstanbulWeek(now), new Date(now.getTime() + 1));
}

/** First emails sent (Sent At) since 00:00 Istanbul today. */
export function firstEmailsToday(leads: readonly LeadRow[], now: Date = new Date()): number {
  return sentBetween(leads, startOfIstanbulDay(now), new Date(now.getTime() + 1));
}

export type SoftCaps = { weekly: number; daily: number };
export type CapStatus = {
  sentThisWeek: number; sentToday: number;
  /** Approved first emails not yet sent (Stage Drafted, Approved Yes). */
  approvedWaiting: number;
  weekly: number; daily: number;
  /** Plain-language warnings; empty when under both caps. */
  warnings: string[];
};

/**
 * Soft caps (WEEKLY_FIRST_EMAIL_CAP, DAILY_WARMUP_CAP). `extra` = how many more approvals are being made now
 * (1 for a single approve, N for bulk). Counts approved-but-unsent drafts as about to go out.
 */
export function capStatus(leads: readonly LeadRow[], caps: SoftCaps, now: Date = new Date(), extra = 0): CapStatus {
  const sentThisWeek = firstEmailsThisWeek(leads, now);
  const sentToday = firstEmailsToday(leads, now);
  const approvedWaiting = firstEmailQueue(leads).approved.length;
  const weekTotal = sentThisWeek + approvedWaiting + extra;
  const dayTotal = sentToday + approvedWaiting + extra;
  const warnings: string[] = [];
  if (caps.weekly > 0 && weekTotal > caps.weekly)
    warnings.push(`This makes ${weekTotal} first emails this week (sent plus approved), above the weekly limit of ${caps.weekly}.`);
  if (caps.daily > 0 && dayTotal > caps.daily)
    warnings.push(`This makes ${dayTotal} first emails for today (sent plus approved), above the warm-up pace of ${caps.daily} a day.`);
  return { sentThisWeek, sentToday, approvedWaiting, weekly: caps.weekly, daily: caps.daily, warnings };
}

// ---- Pipeline -------------------------------------------------------------

/** Counts by Stage, in STAGES order, plus any unknown stage values (empty stage as "(none)"). Zero counts included for known stages. */
export function pipelineCounts(leads: readonly LeadRow[]): { stage: string; count: number }[] {
  const counts = new Map<string, number>(STAGES.map((st) => [st, 0]));
  for (const l of leads) {
    const st = s(l.Stage) || "(none)";
    counts.set(st, (counts.get(st) ?? 0) + 1);
  }
  return [...counts.entries()].map(([stage, count]) => ({ stage, count }));
}

// ---- Home tiles -----------------------------------------------------------

export type HomeCounts = { firstEmailsWaiting: number; followupsWaiting: number; hotUnhandled: number; testSent: number };

export function homeCounts(leads: readonly LeadRow[], settings: Partial<Settings> | null | undefined): HomeCounts {
  return {
    firstEmailsWaiting: firstEmailQueue(leads).waiting.length,
    followupsWaiting: leads.filter((l) => followupTab(l) === "waiting").length,
    hotUnhandled: hotList(leads).length,
    testSent: testSentList(leads, settings).length,
  };
}

export function findLead(leads: readonly LeadRow[], leadId: string): LeadRow | undefined {
  return leads.find((l) => s(l["Lead ID"]) === leadId);
}
