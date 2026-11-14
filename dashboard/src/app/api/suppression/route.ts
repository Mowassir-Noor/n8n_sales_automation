import { json, relay, withWrite } from "@/lib/api";
import { postSuppression } from "@/lib/n8n";
import { suppressionAddErrors, suppressionWriteSchema } from "@/lib/schemas";
import { invalidate } from "@/lib/snapshot";

// add: anyone signed in; remove: admin only, with a reason.
export const POST = withWrite("/api/suppression", suppressionWriteSchema, async ({ user, body, log }) => {
  log.action = body.action;
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
});
