import { json, relay, withWrite } from "@/lib/api";
import { postSettings } from "@/lib/n8n";
import { testSentList } from "@/lib/queues";
import { checkSettingsWrite } from "@/lib/rules";
import { settingsWriteSchema } from "@/lib/schemas";
import { invalidate, readSnapshot } from "@/lib/snapshot";
import type { Settings } from "@/lib/types";

// Role rules per field, go-live rule (header X-Go-Live: confirm, admin only, test-sent list empty), value checks.
export const POST = withWrite("/api/settings", settingsWriteSchema, async ({ user, req, body, log }) => {
  const data = body.data as Partial<Settings>;
  const expect = body.expect as Partial<Settings>;
  log.note = Object.keys(data).join(",");
  const goLiveConfirmed = req.headers.get("x-go-live") === "confirm";
  const clearsTestEmail = "Test Email" in data && String(data["Test Email"] ?? "").trim() === "";

  // Go-live needs an up-to-date list; other saves can use the cache.
  const snap = await readSnapshot({ fresh: clearsTestEmail });
  if (snap.status !== 200 || snap.body.stale) {
    return json({ status: 503, error: "The dashboard cannot read the sheet through n8n right now, so changes are switched off. Try again in a minute." }, 503);
  }
  const check = checkSettingsWrite({
    data, expect, role: user.role, goLiveConfirmed,
    testSentCount: testSentList(snap.body.leads, snap.body.settings).length,
  });
  if (!check.ok) {
    return check.status === 403 ? json({ status: 403, error: check.errors.join(" ") }, 403) : json({ status: 422, errors: check.errors }, 422);
  }
  if (clearsTestEmail) log.note = "go-live";

  const r = await postSettings({ expect, data, requestId: body.requestId, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
});
