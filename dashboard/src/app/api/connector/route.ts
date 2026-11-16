// The signed-in person's own Claude connector URL (key derived from their email; see lib/mcp/keys.ts).
import { errorResponse, json, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { keyFor } from "@/lib/mcp/keys";

export const GET = withUser("/api/connector", async ({ user, url }) => {
  const e = env();
  const key = keyFor(user.email, e.mcpSecret);
  if (!key) return errorResponse(404, "The Claude connector is switched off on this server (MCP_SECRET=off).");
  const base = (e.authUrl || url.origin).replace(/\/+$/, "");
  return json({ url: `${base}/api/mcp/${key}`, email: user.email, role: user.role });
});
