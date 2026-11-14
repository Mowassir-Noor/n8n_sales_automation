// Shared handlers for /api/mcp (key in "Authorization: Bearer <key>") and /api/mcp/<key> (key in the URL,
// for Claude custom connectors, which cannot send headers).
import { env } from "../env";
import { logRequest } from "../http";
import { userForKey } from "./keys";
import { handleMcpPost } from "./server";

const unauthorized = () =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown or missing dashboard key" } }, { status: 401, headers: { "Cache-Control": "no-store" } });

export async function mcpPost(req: Request, key: string | null): Promise<Response> {
  const t0 = Date.now();
  const e = env();
  const user = userForKey(key, e.mcpKeys, { approverEmails: e.approverEmails, adminEmails: e.adminEmails });
  const res = user ? await handleMcpPost(req, user) : unauthorized();
  logRequest({ user: user?.email, method: "POST", route: "/api/mcp", status: res.status, ms: Date.now() - t0 });
  return res;
}

export function mcpNotAllowed(): Response {
  return new Response("Method not allowed: this MCP server answers POST only.", { status: 405, headers: { Allow: "POST" } });
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}
