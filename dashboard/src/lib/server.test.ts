// Server-side modules: env, roles, guards, n8n client mapping, snapshot cache, and the mock n8n end to end.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { readEnv, resetEnvCache } from "./env";
import { roleFor } from "./roles";
import { originAllowed, rateLimit, resetRateLimit, RATE_LIMIT } from "./guards";
import { callN8n, mapN8nResponse, MESSAGES, postLeadAction, getSnapshot, postSettings } from "./n8n";
import { invalidate, readSnapshot, resetSnapshotCache, setSnapshotLoader } from "./snapshot";
import { hashFirst, hashFollowup } from "../../shared/email/index.js";
import type { LeadRow, Snapshot } from "./types";

describe("env", () => {
  it("builds the webhook base from SHEET_ENV", () => {
    expect(readEnv({ NODE_ENV: "development", N8N_INTERNAL_URL: "http://n8n:5678/", SHEET_ENV: "live" }).webhookBase).toBe("http://n8n:5678/webhook/dash/");
    expect(readEnv({ NODE_ENV: "development", SHEET_ENV: "staging" }).webhookBase).toBe("http://n8n:5678/webhook/dash-staging/");
  });
  it("parses allowlists and caps", () => {
    const e = readEnv({ NODE_ENV: "development", APPROVER_EMAILS: " A@Example.com, b@example.com ,", WEEKLY_FIRST_EMAIL_CAP: "50" });
    expect(e.approverEmails).toEqual(["a@example.com", "b@example.com"]);
    expect(e.weeklyFirstEmailCap).toBe(50);
    expect(e.dailyWarmupCap).toBe(20);
  });
  it("ignores DEV_LOGIN_EMAIL in production and requires secrets", () => {
    expect(() => readEnv({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
    const e = readEnv({ NODE_ENV: "production", AUTH_SECRET: "x", DASH_KEY: "k", SHEET_ENV: "live", AUTH_URL: "https://dash.example.com", DEV_LOGIN_EMAIL: "dev@example.com" });
    expect(e.devLoginEmail).toBeUndefined();
  });
});

describe("roles", () => {
  const lists = { approverEmails: ["nil@example.com", "both@example.com"], adminEmails: ["admin@example.com", "BOTH@example.com"] };
  it("maps allowlists, admin wins", () => {
    expect(roleFor("Nil@Example.com", lists)).toBe("approver");
    expect(roleFor("admin@example.com", lists)).toBe("admin");
    expect(roleFor("both@example.com", lists)).toBe("admin");
    expect(roleFor("other@example.com", lists)).toBeNull();
    expect(roleFor("", lists)).toBeNull();
  });
});

describe("guards", () => {
  const req = (h: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers: h });
  it("Origin must equal AUTH_URL", () => {
    expect(originAllowed(req({ origin: "https://dash.example.com" }), "https://dash.example.com", true)).toBe(true);
    expect(originAllowed(req({ origin: "https://evil.example.org" }), "https://dash.example.com", true)).toBe(false);
    expect(originAllowed(req({}), "https://dash.example.com", true)).toBe(false);
  });
  it("dev without AUTH_URL accepts same localhost only", () => {
    expect(originAllowed(req({ origin: "http://localhost:3000", host: "localhost:3000" }), undefined, false)).toBe(true);
    expect(originAllowed(req({ origin: "http://evil.example.org", host: "localhost:3000" }), undefined, false)).toBe(false);
    expect(originAllowed(req({ origin: "http://localhost:3000", host: "localhost:3000" }), undefined, true)).toBe(false);
  });
  it("rate limit 60/min", () => {
    resetRateLimit();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(rateLimit("a@example.com", t + i)).toBe(true);
    expect(rateLimit("a@example.com", t + 100)).toBe(false);
    expect(rateLimit("b@example.com", t + 100)).toBe(true);
    expect(rateLimit("a@example.com", t + 60_001)).toBe(true);
  });
});

describe("n8n response mapping", () => {
  it("maps statuses", () => {
    expect(mapN8nResponse(200, { ok: true, row: { a: 1 } })).toEqual({ status: 200, ok: true, row: { a: 1 } });
    expect(mapN8nResponse(409, { conflict: true, row: null })).toMatchObject({ status: 409, conflict: true, message: MESSAGES.conflict });
    expect(mapN8nResponse(422, { errors: ["x"] })).toEqual({ status: 422, errors: ["x"] });
    expect(mapN8nResponse(403, { error: "Admin only" })).toEqual({ status: 403, error: "Admin only" });
    expect(mapN8nResponse(403, { code: 403, message: "Authorization data is wrong!" })).toEqual({ status: 502, error: MESSAGES.badKey });
    expect(mapN8nResponse(404, "")).toEqual({ status: 503, error: MESSAGES.notFound });
    expect(mapN8nResponse(500, { error: "Sheets quota" })).toEqual({ status: 502, error: `${MESSAGES.serverError}: Sheets quota` });
    expect(mapN8nResponse(200, "<html>")).toEqual({ status: 502, error: MESSAGES.badResponse });
  });
});

describe("snapshot cache", () => {
  const snap = (n: number) => ({ status: 200 as const, ok: true as const, fetchedAt: String(n), headersOk: true, headerProblems: [], leads: [], settings: {} as Snapshot["settings"], suppression: [], social: [] });
  beforeEach(() => resetSnapshotCache());
  it("caches for 20 s, invalidates, shares in-flight requests", async () => {
    let calls = 0;
    setSnapshotLoader(async () => snap(++calls));
    const [a, b] = await Promise.all([readSnapshot(), readSnapshot()]);
    expect(calls).toBe(1);
    expect(a.status === 200 && a.body.fetchedAt).toBe("1");
    expect(b.status === 200 && b.body.fetchedAt).toBe("1");
    await readSnapshot();
    expect(calls).toBe(1);
    await readSnapshot({ fresh: true });
    expect(calls).toBe(2);
    invalidate();
    await readSnapshot();
    expect(calls).toBe(3);
  });
  it("serves the last good snapshot as stale when n8n fails, else 503", async () => {
    setSnapshotLoader(async () => ({ status: 503, error: "down" }));
    const r0 = await readSnapshot();
    expect(r0.status).toBe(503);
    setSnapshotLoader(async () => snap(1));
    await readSnapshot();
    setSnapshotLoader(async () => ({ status: 503, error: "down" }));
    const r = await readSnapshot({ fresh: true });
    expect(r.status).toBe(200);
    expect(r.status === 200 && r.body.stale).toBe(true);
    expect(r.status === 200 && typeof r.body.ageSeconds).toBe("number");
  });
});

// ---- Mock n8n end to end -----------------------------------------------------

const PORT = 5790 + Math.floor(Math.random() * 100);
let child: ChildProcess;

async function waitForPort() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/__mock/state`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("mock did not start");
}

describe("mock n8n through the client", () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ["--no-warnings", join(__dirname, "../../dev/mock-n8n.mjs")], {
      env: { ...process.env, MOCK_N8N_PORT: String(PORT), DASH_KEY: "test-key" }, stdio: "ignore",
    });
    await waitForPort();
    Object.assign(process.env, { N8N_INTERNAL_URL: `http://127.0.0.1:${PORT}`, DASH_KEY: "test-key", SHEET_ENV: "staging" });
    resetEnvCache();
  });
  afterAll(() => { child?.kill(); });
  beforeEach(async () => {
    await fetch(`http://127.0.0.1:${PORT}/__mock/state`, { method: "POST", body: JSON.stringify({ reset: true, wf3Running: false }) });
  });

  const lead = async (id: string) => {
    const s = await getSnapshot();
    if (s.status !== 200) throw new Error("snapshot failed");
    return s.leads.find((l) => l["Lead ID"] === id)!;
  };
  const expectOf = (l: LeadRow, kind: "first" | "fu" | "none" = "first") => ({
    lastUpdated: l["Last Updated"], stage: l.Stage, approved: l.Approved,
    draftHash: kind === "first" ? hashFirst(l.Subject, l["Draft Body"]) : kind === "fu" ? hashFollowup(l["Follow-up Draft"]) : "",
  });
  const actor = { actor: "nil@example.com", actorRole: "approver" as const };

  it("rejects a wrong key as a config problem", async () => {
    process.env.DASH_KEY = "wrong"; resetEnvCache();
    const r = await callN8n("snapshot", {});
    process.env.DASH_KEY = "test-key"; resetEnvCache();
    expect(r).toEqual({ status: 502, error: MESSAGES.badKey });
  });

  it("approves, dedupes by requestId, then 409s on a stale expect", async () => {
    const l = await lead("L001");
    const req = { action: "approve_first" as const, leadId: "L001", expect: expectOf(l), data: {}, requestId: "req-approve-1", ...actor };
    const r1 = await postLeadAction(req);
    expect(r1.status).toBe(200);
    expect(r1.status === 200 && r1.row.Approved).toBe("Yes");
    const r2 = await postLeadAction(req); // same requestId: stored result
    expect(r2).toEqual(r1);
    const r3 = await postLeadAction({ ...req, requestId: "req-approve-2" }); // stale expect
    expect(r3.status).toBe(409);
    const log = await callN8n("log", { leadId: "L001" });
    expect(log.status === 200 && (log.rows as { Step: string; Reason: string }[])[0]).toMatchObject({ Step: "approve_first", Reason: "by nil@example.com" });
  });

  it("refuses Needs fix with 422 and admin-only actions with 403", async () => {
    const l3 = await lead("L003");
    const r = await postLeadAction({ action: "approve_first", leadId: "L003", expect: expectOf(l3), data: {}, requestId: "req-nf-1", ...actor });
    expect(r.status).toBe(422);
    const l8 = await lead("L008");
    const r2 = await postLeadAction({ action: "reset_test_sent", leadId: "L008", expect: expectOf(l8, "none"), data: {}, requestId: "req-reset-1", ...actor });
    expect(r2.status).toBe(403);
    const r3 = await postLeadAction({ action: "reset_test_sent", leadId: "L008", expect: expectOf(l8, "none"), data: {}, requestId: "req-reset-2", actor: "admin@example.com", actorRole: "admin" });
    expect(r3.status === 200 && r3.row.Stage).toBe("Drafted");
  });

  it("edit_first re-checks and fixes the address line break", async () => {
    const l = await lead("L017");
    const r = await postLeadAction({ action: "edit_first", leadId: "L017", expect: expectOf(l), data: { subject: l.Subject, body: l["Draft Body"] }, requestId: "req-edit-1", ...actor });
    expect(r.status).toBe(200);
    if (r.status === 200) {
      expect(r.row["Draft Body"]).toContain("Sk.\nNo: 12");
      expect(r.row["Compliance Status"]).toBe("OK");
      expect(r.row["Draft Body EN"]).toBe("");
      expect(r.row.Approved).toBe("Pending");
    }
  });

  it("go-live is refused while test-sent leads remain", async () => {
    const s = await getSnapshot();
    if (s.status !== 200) throw new Error();
    const r = await postSettings({ expect: { "Test Email": s.settings["Test Email"] }, data: { "Test Email": "" }, requestId: "req-golive-1", actor: "admin@example.com", actorRole: "admin" });
    expect(r.status).toBe(422);
  });
});
