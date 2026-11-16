import { describe, expect, it } from "vitest";
import type { LeadRow, Settings } from "./types";
import { LEAD_HEADERS, HOT_HANDLED } from "./types";
import {
  capStatus, firstEmailQueue, firstEmailsThisWeek, firstEmailsToday, firstEmailTab, followupNumber,
  followupQueue, followupTab, homeCounts, hotList, hubspotUsage, isTestMode, istanbulParts, nextRun,
  pipelineCounts, replyList, startOfIstanbulWeek, testModeBanner, testSentList,
} from "./queues";

function lead(over: Partial<LeadRow>): LeadRow {
  const row = Object.fromEntries([...LEAD_HEADERS, HOT_HANDLED].map((h) => [h, ""])) as unknown as LeadRow;
  return { ...row, "Lead ID": "L001", ...over };
}
const settings = (over: Partial<Settings> = {}) => ({ "Test Email": "", ...over }) as Partial<Settings>;

describe("first-email queue", () => {
  it("splits Drafted rows by Approved", () => {
    const rows = [
      lead({ "Lead ID": "a", Stage: "Drafted", Approved: "" }),
      lead({ "Lead ID": "b", Stage: "Drafted", Approved: "Pending" }),
      lead({ "Lead ID": "c", Stage: "Drafted", Approved: "Edit" }),
      lead({ "Lead ID": "d", Stage: "Drafted", Approved: "Yes" }),
      lead({ "Lead ID": "e", Stage: "Drafted", Approved: "No" }),
      lead({ "Lead ID": "f", Stage: "Sent", Approved: "Yes" }),
    ];
    const q = firstEmailQueue(rows);
    expect(q.waiting.map((r) => r["Lead ID"])).toEqual(["a", "b", "c"]);
    expect(q.approved.map((r) => r["Lead ID"])).toEqual(["d"]);
    expect(q.rejected.map((r) => r["Lead ID"])).toEqual(["e"]);
    expect(firstEmailTab(rows[5])).toBeNull();
  });
});

describe("follow-up queue", () => {
  it("needs a follow-up stage and a non-empty draft", () => {
    const rows = [
      lead({ "Lead ID": "a", Stage: "Sent", "Follow-up Draft": "Hi", "Follow-up Count": "" }),
      lead({ "Lead ID": "b", Stage: "Follow-up 2", "Follow-up Draft": "Hi", "Follow-up Count": "2", Approved: "Yes" }),
      lead({ "Lead ID": "c", Stage: "Sent", "Follow-up Draft": "", Approved: "Yes" }), // a sent first email
      lead({ "Lead ID": "d", Stage: "Replied - Warm", "Follow-up Draft": "stale" }),
      lead({ "Lead ID": "e", Stage: "Follow-up 3", "Follow-up Draft": "x" }),
    ];
    expect(followupQueue(rows).map((r) => r["Lead ID"])).toEqual(["a", "b"]);
    expect(followupNumber(rows[0])).toBe(1);
    expect(followupNumber(rows[1])).toBe(3);
    expect(followupTab(rows[0])).toBe("waiting");
    expect(followupTab(rows[1])).toBe("approved");
    expect(followupTab(rows[2])).toBeNull();
  });
});

describe("hot and replies", () => {
  it("lists unhandled Hot replies, pinned first", () => {
    const rows = [
      lead({ "Lead ID": "w", "Reply Category": "Warm", "Last Updated": "2026-11-13T10:00:00.000+03:00" }),
      lead({ "Lead ID": "h1", "Reply Category": "Hot", "Last Updated": "2026-11-10T10:00:00.000+03:00" }),
      lead({ "Lead ID": "h2", "Reply Category": "Hot", "Hot Handled": "2026-11-12T10:00:00+03:00 by a@example.com" }),
      lead({ "Lead ID": "x" }),
    ];
    expect(hotList(rows).map((r) => r["Lead ID"])).toEqual(["h1"]);
    expect(replyList(rows).map((r) => r["Lead ID"])).toEqual(["h1", "w", "h2"]);
  });
});

describe("test mode and go-live list", () => {
  const rows = [
    lead({ "Lead ID": "a", Stage: "Sent", "Sent At": "2026-11-10T10:00:00.000+03:00" }),
    lead({ "Lead ID": "b", Stage: "Opted out", "Sent At": "2026-11-10T10:00:00.000+03:00" }),
    lead({ "Lead ID": "c", Stage: "Closed - No reply", "Sent At": "2026-11-10T10:00:00.000+03:00" }),
    lead({ "Lead ID": "d", Stage: "Drafted" }),
  ];
  it("is empty when Test Email is empty", () => {
    expect(isTestMode(settings())).toBe(false);
    expect(testSentList(rows, settings())).toEqual([]);
    expect(testModeBanner(settings())).toEqual({ on: false });
  });
  it("lists unfinished test-sent rows", () => {
    const st = settings({ "Test Email": "test@example.com" });
    expect(testSentList(rows, st).map((r) => r["Lead ID"])).toEqual(["a"]);
    const b = testModeBanner(st);
    expect(b.on && b.message).toBe("TEST MODE: all emails go to test@example.com, not to leads");
  });
});

describe("next run (Istanbul)", () => {
  // Istanbul is UTC+3 all year.
  const at = (iso: string) => new Date(iso);
  it("WF3 picks 10:00 or 14:00 on weekdays", () => {
    // Fri 14 Nov 2026 09:00 Istanbul
    expect(nextRun("wf3", at("2026-11-13T06:00:00Z")).toISOString()).toBe("2026-11-13T07:00:00.000Z");
    expect(nextRun("wf3", at("2026-11-13T07:00:00Z")).toISOString()).toBe("2026-11-13T11:00:00.000Z");
    // Friday 14:30 -> Monday 10:00
    expect(nextRun("wf3", at("2026-11-13T11:30:00Z")).toISOString()).toBe("2026-11-16T07:00:00.000Z");
    // Saturday -> Monday
    expect(nextRun("wf3", at("2026-11-14T09:00:00Z")).toISOString()).toBe("2026-11-16T07:00:00.000Z");
  });
  it("WF5 picks weekdays 11:00", () => {
    expect(nextRun("wf5", at("2026-11-16T07:59:00Z")).toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(nextRun("wf5", at("2026-11-16T08:00:00Z")).toISOString()).toBe("2026-11-17T08:00:00.000Z");
    // just after midnight Istanbul on Monday (Sunday 21:30 UTC)
    expect(nextRun("wf5", at("2026-11-15T21:30:00Z")).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });
  it("istanbulParts handles the date boundary", () => {
    const p = istanbulParts(at("2026-11-15T21:30:00Z"));
    expect([p.year, p.month, p.day, p.hour, p.minute, p.weekday]).toEqual([2026, 11, 16, 0, 30, 1]);
  });
});

describe("HubSpot usage (WF3 counting rule)", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("counts first emails, follow-ups and replies in the UTC month", () => {
    const rows = [
      lead({ "Lead ID": "a", "Sent At": "2026-11-02T10:00:00.000+03:00", "Follow-up Count": "2" }), // 2 + fu at +4 (6th), +10 (12th) = 4
      lead({ "Lead ID": "b", "Sent At": "2026-10-25T10:00:00.000+03:00", "Follow-up Count": "3" }), // fu +10 (Nov 4), +20 (Nov 14) = 2
      lead({ "Lead ID": "c", "Reply Category": "Hot", "Last Updated": "2026-11-05T10:00:00.000+03:00" }), // 2
      lead({ "Lead ID": "d", "Reply Category": "Warm", "Last Updated": "2026-10-05T10:00:00.000+03:00" }), // 0
      lead({ "Lead ID": "", "Sent At": "2026-11-02T10:00:00.000+03:00" }), // ignored: no Lead ID
    ];
    const u = hubspotUsage(rows, { "HubSpot Monthly Limit": "10", "HubSpot Pause Percent": "80" }, now);
    expect(u.detail).toEqual({ firstEmails: 1, followUps: 4, replies: 1 });
    expect(u.used).toBe(8);
    expect(u.percent).toBe(80);
    expect(u.paused).toBe(true);
  });
  it("uses defaults 3000 / 80", () => {
    const u = hubspotUsage([], {}, now);
    expect([u.limit, u.pauseAt, u.used, u.paused]).toEqual([3000, 80, 0, false]);
  });
});

describe("soft caps", () => {
  // Wed 18 Nov 2026 15:00 Istanbul
  const now = new Date("2026-11-18T12:00:00Z");
  const rows = [
    lead({ "Lead ID": "a", "Sent At": "2026-11-16T10:01:00.000+03:00", Stage: "Sent" }), // Mon, this week
    lead({ "Lead ID": "b", "Sent At": "2026-11-18T10:01:00.000+03:00", Stage: "Sent" }), // today
    lead({ "Lead ID": "c", "Sent At": "2026-11-15T23:59:00.000+03:00", Stage: "Sent" }), // Sunday, last week
    lead({ "Lead ID": "d", Stage: "Drafted", Approved: "Yes" }),
  ];
  it("counts by Istanbul week and day", () => {
    expect(startOfIstanbulWeek(now).toISOString()).toBe("2026-11-15T21:00:00.000Z");
    expect(firstEmailsThisWeek(rows, now)).toBe(2);
    expect(firstEmailsToday(rows, now)).toBe(1);
  });
  it("warns past either cap", () => {
    expect(capStatus(rows, { weekly: 100, daily: 20 }, now, 1).warnings).toEqual([]);
    const c = capStatus(rows, { weekly: 3, daily: 2 }, now, 1);
    expect(c.approvedWaiting).toBe(1);
    expect(c.warnings).toHaveLength(2);
  });
});

describe("pipeline and home", () => {
  it("counts by stage in order with unknowns at the end", () => {
    const rows = [lead({ Stage: "Drafted" }), lead({ Stage: "Drafted" }), lead({ Stage: "Weird" }), lead({ Stage: "" })];
    const p = pipelineCounts(rows);
    expect(p[0]).toEqual({ stage: "New", count: 0 });
    expect(p.find((x) => x.stage === "Drafted")?.count).toBe(2);
    expect(p.slice(-2)).toEqual([{ stage: "Weird", count: 1 }, { stage: "(none)", count: 1 }]);
  });
  it("home counts", () => {
    const rows = [
      lead({ Stage: "Drafted", Approved: "Pending" }),
      lead({ Stage: "Sent", "Follow-up Draft": "x", Approved: "Pending" }),
      lead({ Stage: "Sent", "Follow-up Draft": "x", Approved: "Yes" }),
      lead({ "Reply Category": "Hot" }),
    ];
    expect(homeCounts(rows, settings())).toEqual({ firstEmailsWaiting: 1, followupsWaiting: 1, hotUnhandled: 1, testSent: 0 });
  });
});
