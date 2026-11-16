// The checks and n8n calls behind every write, shared by the page API routes and the MCP tools.
// Callers do authentication, Origin check, rate limit and body validation first.
import type { z } from "zod";
import { json, relay } from "./http";
import { getStatus, postLeadAction, postSettings, postSocial, postSuppression } from "./n8n";
import { findLead, testSentList } from "./queues";
import { canDoLeadAction } from "./roles";
import { checkLeadAction, checkSettingsWrite } from "./rules";
import type { leadActionSchema, settingsWriteSchema, socialWriteSchema, suppressionWriteSchema } from "./schemas";
import { suppressionAddErrors } from "./schemas";
import { invalidate, readSnapshot } from "./snapshot";
import type { SessionUser, Settings } from "./types";

const NO_SHEET = "The dashboard cannot read the sheet through n8n right now, so changes are switched off. Try again in a minute.";

export async function leadActionWrite(user: SessionUser, body: z.infer<typeof leadActionSchema>): Promise<Response> {
  if (!canDoLeadAction(user.role, body.action)) {
    return json({ status: 403, error: "Only the admin can clean up test-sent leads." }, 403);
  }
  // Pre-checks on the cached snapshot; re-read it when the user has seen a newer row than the cache holds.
  let snap = await readSnapshot();
  let lead = snap.status === 200 ? findLead(snap.body.leads, body.leadId) : undefined;
  if (snap.status === 200 && (!lead || lead["Last Updated"] !== body.expect.lastUpdated)) {
    snap = await readSnapshot({ fresh: true });
    lead = snap.status === 200 ? findLead(snap.body.leads, body.leadId) : undefined;
  }
  if (snap.status !== 200 || snap.body.stale) return json({ status: 503, error: NO_SHEET }, 503);
  if (!snap.body.headersOk) {
    return json({ status: 422, errors: ["Changes are switched off because the Leads tab headers do not match what the dashboard expects: " + snap.body.headerProblems.join("; ")] }, 422);
  }
  if (!lead) {
    return json({ status: 409, conflict: true, row: null, message: `Lead ${body.leadId} is no longer in the sheet. Nothing was saved.` }, 409);
  }
  let wf3Running: boolean | undefined;
  if (body.action === "unapprove_first") {
    const st = await getStatus();
    wf3Running = st.status === 200 ? st.running.wf3 : undefined;
  }
  const check = checkLeadAction(body, { lead, settings: snap.body.settings, suppression: snap.body.suppression, role: user.role, wf3Running });
  if (!check.ok) {
    return check.status === 403 ? json({ status: 403, error: check.errors.join(" ") }, 403) : json({ status: 422, errors: check.errors }, 422);
  }
  const r = await postLeadAction({ ...body, data: body.data ?? {}, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
}

/** Role rules per field, go-live rule (admin only, confirmed, test-sent list empty), value checks. */
export async function settingsWrite(user: SessionUser, body: z.infer<typeof settingsWriteSchema>, goLiveConfirmed: boolean): Promise<Response> {
  const data = body.data as Partial<Settings>;
  const expect = body.expect as Partial<Settings>;
  const clearsTestEmail = "Test Email" in data && String(data["Test Email"] ?? "").trim() === "";
  // Go-live needs an up-to-date list; other saves can use the cache.
  const snap = await readSnapshot({ fresh: clearsTestEmail });
  if (snap.status !== 200 || snap.body.stale) return json({ status: 503, error: NO_SHEET }, 503);
  const check = checkSettingsWrite({
    data, expect, role: user.role, goLiveConfirmed,
    testSentCount: testSentList(snap.body.leads, snap.body.settings).length,
  });
  if (!check.ok) {
    return check.status === 403 ? json({ status: 403, error: check.errors.join(" ") }, 403) : json({ status: 422, errors: check.errors }, 422);
  }
  const r = await postSettings({ expect, data, requestId: body.requestId, actor: user.email, actorRole: user.role, ...(clearsTestEmail && goLiveConfirmed ? { goLive: true } : {}) });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
}

/** add: anyone signed in; remove: admin only, with a reason. */
export async function suppressionWrite(user: SessionUser, body: z.infer<typeof suppressionWriteSchema>): Promise<Response> {
  if (body.action === "remove" && user.role !== "admin") {
    return json({ status: 403, error: "Only the admin can remove a Suppression row." }, 403);
  }
  if (body.action === "add") {
    const errors = suppressionAddErrors(body.data);
    if (errors.length) return json({ status: 422, errors }, 422);
    if (body.data.Domain) body.data.Domain = body.data.Domain.replace(/^@/, "");
  }
  const r = await postSuppression({ ...body, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
}

/** Set Approved / Nil Notes / Posted on one Social row (matched by row number + expect). */
export async function socialWrite(user: SessionUser, body: z.infer<typeof socialWriteSchema>): Promise<Response> {
  const r = await postSocial({ ...body, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
}
