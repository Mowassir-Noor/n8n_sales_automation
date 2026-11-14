import { json, relay, withWrite } from "@/lib/api";
import { getStatus, postLeadAction } from "@/lib/n8n";
import { canDoLeadAction } from "@/lib/roles";
import { checkLeadAction } from "@/lib/rules";
import { leadActionSchema } from "@/lib/schemas";
import { invalidate, readSnapshot } from "@/lib/snapshot";
import { findLead } from "@/lib/queues";

export const POST = withWrite("/api/lead-action", leadActionSchema, async ({ user, body, log }) => {
  log.action = body.action;
  log.leadId = body.leadId;
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
  if (snap.status === 200 && !snap.body.stale) {
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
    const check = checkLeadAction(body, {
      lead, settings: snap.body.settings, suppression: snap.body.suppression, role: user.role, wf3Running,
    });
    if (!check.ok) {
      return check.status === 403 ? json({ status: 403, error: check.errors.join(" ") }, 403) : json({ status: 422, errors: check.errors }, 422);
    }
  } else {
    return json({ status: 503, error: "The dashboard cannot read the sheet through n8n right now, so changes are switched off. Try again in a minute." }, 503);
  }

  const r = await postLeadAction({ ...body, data: body.data ?? {}, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
});
