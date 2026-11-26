import { json, withUser } from "@/lib/api";
import { getLog } from "@/lib/n8n";
import { logQuerySchema } from "@/lib/schemas";

// LogQuery as query string: ?leadId=&workflow=&from=&to=&page=&pageSize=
export const GET = withUser("/api/log", async ({ url }) => {
  const parsed = logQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ status: 422, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 422);
  }
  const q = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined && v !== ""));
  const r = await getLog({ page: 1, pageSize: 50, ...q });
  return json(r, r.status);
});
