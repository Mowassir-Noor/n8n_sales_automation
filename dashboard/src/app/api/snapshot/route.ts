import { json, withUser } from "@/lib/api";
import { readSnapshot } from "@/lib/snapshot";

// ?fresh=1 skips the 20 s cache. On n8n failure: the last snapshot with stale: true, or 503.
export const GET = withUser("/api/snapshot", async ({ url }) => {
  const fresh = url.searchParams.get("fresh") === "1";
  const r = await readSnapshot({ fresh });
  return json(r.body, r.status);
});
