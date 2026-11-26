import { json, withUser } from "@/lib/api";
import { getStatus } from "@/lib/n8n";

// Last executions of WF0–WF6 and whether WF3/WF5 run now. 503 when n8n is unreachable.
export const GET = withUser("/api/status", async () => {
  const r = await getStatus();
  if (r.status === 200) return json(r, 200);
  return json({ status: 503, error: "error" in r ? r.error : "n8n is not reachable." }, 503);
});
