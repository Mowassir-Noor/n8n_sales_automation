import { describe, expect, it } from "vitest";
import fixtures from "../../dev/fixtures.json";
import type { LeadAction, LeadRow, Settings, SuppressionRow } from "./types";
import { checkLeadAction, checkSettingsWrite, settingsFieldAccess, validateSettingsValues } from "./rules";

const settings = fixtures.settings as Settings;
const suppression = fixtures.suppression as SuppressionRow[];
const leads = fixtures.leads as unknown as LeadRow[];
const L = (id: string) => ({ ...leads.find((l) => l["Lead ID"] === id)! });
const run = (action: LeadAction, lead: LeadRow, data = {}, role: "approver" | "admin" = "approver", wf3Running?: boolean) =>
  checkLeadAction({ action, data }, { lead, settings, suppression, role, wf3Running });

describe("lead action pre-checks", () => {
  it("approve_first: OK draft passes; Needs fix and Blocked fail", () => {
    expect(run("approve_first", L("L001"))).toEqual({ ok: true });
    const nf = run("approve_first", L("L003"));
    expect(nf.ok).toBe(false);
    if (!nf.ok) {
      expect(nf.status).toBe(422);
      expect(nf.errors.join(" ")).toMatch(/Needs fix/);
      expect(nf.errors.join(" ")).toMatch(/Opt-out sentence missing/);
    }
    const bl = run("approve_first", L("L004"));
    expect(!bl.ok && bl.errors.join(" ")).toMatch(/Suppression list/);
  });
  it("approve_first re-checks the current text even when the sheet says OK", () => {
    const lead = { ...L("L001"), "Draft Body": L("L001")["Draft Body"].replace(/Deniz Aydın\n/, "") };
    const r = run("approve_first", lead);
    expect(!r.ok && r.errors.join(" ")).toMatch(/signature line not found/);
  });
  it("approve_first refuses opted-out leads", () => {
    const r = run("approve_first", { ...L("L001"), "Opt-out": "Yes" });
    expect(!r.ok && r.errors.join(" ")).toMatch(/opted out/);
  });
  it("reject_first needs a note and Stage Drafted", () => {
    expect(run("reject_first", L("L001"), {}).ok).toBe(false);
    expect(run("reject_first", L("L001"), { note: "no" }).ok).toBe(true);
    expect(run("reject_first", L("L008"), { note: "no" }).ok).toBe(false);
  });
  it("edit_first not on an approved draft", () => {
    expect(run("edit_first", L("L005"), { subject: "s", body: "b" }).ok).toBe(false);
    expect(run("edit_first", L("L001"), { subject: "s", body: "b" }).ok).toBe(true);
  });
  it("unapprove_first blocked while WF3 runs", () => {
    expect(run("unapprove_first", L("L005"), {}, "approver", false).ok).toBe(true);
    const r = run("unapprove_first", L("L005"), {}, "approver", true);
    expect(!r.ok && r.errors[0]).toMatch(/WF3 is sending/);
    expect(run("unapprove_first", L("L001")).ok).toBe(false);
  });
  it("follow-up actions need a follow-up stage and draft", () => {
    expect(run("approve_followup", L("L008")).ok).toBe(true);
    expect(run("approve_followup", L("L013")).ok).toBe(false); // replied, stale draft
    expect(run("rewrite_followup", L("L009"), {}).ok).toBe(false);
    expect(run("rewrite_followup", L("L009"), { note: "shorter" }).ok).toBe(true);
    expect(run("decline_followup", L("L016")).ok).toBe(false); // no draft
    const hype = run("approve_followup", { ...L("L008"), "Follow-up Draft": "100% guaranteed results" });
    expect(!hype.ok && hype.errors.join(" ")).toMatch(/Hype wording/);
  });
  it("reply actions", () => {
    expect(run("set_reply_category", L("L013"), { category: "Hot" }).ok).toBe(true);
    expect(run("set_reply_category", L("L001"), { category: "Hot" }).ok).toBe(false);
    expect(run("mark_hot_handled", L("L011")).ok).toBe(true);
    expect(run("mark_hot_handled", L("L013")).ok).toBe(false);
    expect(run("opt_out", L("L001")).ok).toBe(true);
  });
  it("go-live cleanup is admin only and needs test mode + Sent At", () => {
    const r = run("reset_test_sent", L("L008"));
    expect(!r.ok && r.status).toBe(403);
    expect(run("reset_test_sent", L("L008"), {}, "admin").ok).toBe(true);
    expect(run("close_test_sent", L("L001"), {}, "admin").ok).toBe(false);
    const live = checkLeadAction({ action: "reset_test_sent", data: {} }, { lead: L("L008"), settings: { ...settings, "Test Email": "" }, suppression, role: "admin" });
    expect(live.ok).toBe(false);
  });
});

describe("settings rules", () => {
  it("field access", () => {
    expect(settingsFieldAccess("Sender Name", "approver")).toBe("edit");
    expect(settingsFieldAccess("Test Email", "approver")).toBe("readonly");
    expect(settingsFieldAccess("Test Email", "admin")).toBe("edit");
    expect(settingsFieldAccess("Mail Provider", "admin")).toBe("readonly");
  });
  const base = { role: "admin" as const, goLiveConfirmed: false, testSentCount: 0 };
  it("refuses read-only and admin-only fields", () => {
    expect(checkSettingsWrite({ ...base, data: { "SMTP From": "x" }, expect: { "SMTP From": "" } })).toMatchObject({ ok: false, status: 403 });
    expect(checkSettingsWrite({ ...base, role: "approver", data: { "Seed Every": "5" }, expect: { "Seed Every": "12" } })).toMatchObject({ ok: false, status: 403 });
    expect(checkSettingsWrite({ ...base, role: "approver", data: { "Sender Title": "CEO" }, expect: { "Sender Title": "x" } })).toEqual({ ok: true });
  });
  it("go-live rule", () => {
    const clear = { data: { "Test Email": "" }, expect: { "Test Email": "t@example.com" } };
    expect(checkSettingsWrite({ ...base, ...clear })).toMatchObject({ ok: false, status: 422 });
    expect(checkSettingsWrite({ ...base, ...clear, goLiveConfirmed: true, testSentCount: 3 })).toMatchObject({ ok: false, status: 422 });
    expect(checkSettingsWrite({ ...base, ...clear, goLiveConfirmed: true, role: "approver" })).toMatchObject({ ok: false, status: 403 });
    expect(checkSettingsWrite({ ...base, ...clear, goLiveConfirmed: true })).toEqual({ ok: true });
    // changing to another address is fine for the admin
    expect(checkSettingsWrite({ ...base, data: { "Test Email": "other@example.com" }, expect: { "Test Email": "t@example.com" } })).toEqual({ ok: true });
  });
  it("value checks", () => {
    expect(validateSettingsValues({ "HubSpot Pause Percent": "120", "Nil Email": "nope", "Sender Name": " " })).toHaveLength(3);
    expect(validateSettingsValues({ "Nil Telegram Chat ID": "-100123", "Company Website": "https://www.example.com" })).toEqual([]);
  });
});
