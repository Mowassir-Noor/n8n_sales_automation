import { relay, withWrite } from "@/lib/api";
import { postSocial } from "@/lib/n8n";
import { socialWriteSchema } from "@/lib/schemas";
import { invalidate } from "@/lib/snapshot";

// Set Approved / Nil Notes / Posted on one Social row (matched by row number + expect).
export const POST = withWrite("/api/social", socialWriteSchema, async ({ user, body, log }) => {
  log.note = `row ${body.rowNumber}`;
  const r = await postSocial({ ...body, actor: user.email, actorRole: user.role });
  if (r.status !== 422 && r.status !== 403) invalidate();
  return relay(r);
});
