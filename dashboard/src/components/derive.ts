// UI-side helpers on top of the backend's pure derivations in @/lib/queues
// (queues, schedules, HubSpot estimate, caps). Only formatting and UI-specific bits live here.
import type { LeadRow } from "@/lib/types";
import { nextRun, SCHEDULES, istanbulParts, firstEmailQueue, type ScheduleKey } from "@/lib/queues";

export {
  firstEmailQueue,
  firstEmailTab,
  followupQueue,
  followupTab,
  followupNumber,
  isFollowupPending,
  isHot,
  hotList,
  replyList,
  isTestMode,
  testSentList,
  testModeBanner,
  hubspotUsage,
  capStatus,
  pipelineCounts,
  homeCounts,
  findLead,
  nextRun,
  SCHEDULES,
  STAGES,
  FOLLOWUP_STAGES,
  byLastUpdatedDesc,
} from "@/lib/queues";
export type { FirstEmailTab, FollowupTab, ScheduleKey } from "@/lib/queues";

/** Fallback soft caps (plan defaults) until /api/me's config has loaded; see useSoftCaps(). */
export const SOFT_CAPS = { weekly: 100, daily: 20 };

/** HubSpot contact record URL, or null when the portal ID or the contact ID is missing. */
export function hubspotContactUrl(portalId: string | null | undefined, contactId: string | null | undefined): string | null {
  const p = String(portalId ?? "").trim();
  const c = String(contactId ?? "").trim();
  if (!p || !c) return null;
  return `https://app.hubspot.com/contacts/${encodeURIComponent(p)}/record/0-1/${encodeURIComponent(c)}`;
}

/** WF3 sends at most 15 first emails per run ('Limit 15' node), in sheet order. */
export const WF3_PER_RUN = 15;

export function upcomingRuns(key: ScheduleKey, count: number, now: Date = new Date()): Date[] {
  const out: Date[] = [];
  let t = now;
  for (let i = 0; i < count; i++) {
    const n = nextRun(key, t);
    out.push(n);
    t = new Date(n.getTime() + 1000);
  }
  return out;
}

/** Lead ID -> the WF3 run that will send it (approved first emails only, 15 per run in sheet order). */
export function approvedSendTimes(leads: readonly LeadRow[], now: Date = new Date()): Map<string, Date> {
  const approved = [...firstEmailQueue(leads).approved].sort((a, b) => (a.row_number ?? 0) - (b.row_number ?? 0));
  const runs = upcomingRuns("wf3", Math.max(1, Math.ceil(approved.length / WF3_PER_RUN)), now);
  const out = new Map<string, Date>();
  approved.forEach((r, i) => out.set(r["Lead ID"], runs[Math.floor(i / WF3_PER_RUN)]));
  return out;
}

export const SCHEDULE_ORDER: ScheduleKey[] = ["wf3", "wf5", "wf2", "wf1", "wf0", "wf6"];
export function scheduleName(key: ScheduleKey): string {
  return SCHEDULES[key].name;
}

// ---- Formatting (Istanbul) -------------------------------------------------------

const TZ = "Europe/Istanbul";
const fmtFull = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDateTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "today 14:00", "tomorrow 10:00" or "Mon 17 Nov, 10:00" (Istanbul). */
export function fmtRun(d: Date, now: Date = new Date()): string {
  const a = istanbulParts(d);
  const b = istanbulParts(now);
  const dayDiff = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86400_000);
  if (dayDiff === 0) return `today ${fmtTime.format(d)}`;
  if (dayDiff === 1) return `tomorrow ${fmtTime.format(d)}`;
  return fmtFull.format(d);
}

export function parseDate(v: string | undefined | null): Date | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  // "yyyy-MM-dd HH:mm" or "yyyy-MM-dd" (older rows) are Istanbul wall-clock times (UTC+3).
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) - 3 * 3600_000);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDateTimeIst(v: string | Date | undefined | null): string {
  const d = v instanceof Date ? v : parseDate(v);
  if (d) return fmtDateTime.format(d);
  return typeof v === "string" ? v : "";
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function ago(v: string | Date | undefined | null, now: Date = new Date()): string {
  const d = v instanceof Date ? v : parseDate(v);
  return d ? fmtDuration((now.getTime() - d.getTime()) / 1000) : "";
}

export function languageFlag(lang: string): string {
  const l = (lang || "").trim().toLowerCase();
  if (l === "tr") return "🇹🇷";
  if (l === "en") return "🇬🇧";
  return "";
}

export function domainOf(email: string): string {
  const i = email.lastIndexOf("@");
  return i >= 0 ? email.slice(i + 1).trim().toLowerCase() : "";
}
