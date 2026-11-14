// A small, stateless MCP server over Streamable HTTP (JSON responses, no SSE, no sessions):
// initialize, ping, tools/list, tools/call. Auth happens in the route (lib/mcp/keys.ts).
import { rateLimit } from "../guards";
import type { SessionUser } from "../types";
import { findTool, TOOLS } from "./tools";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "texprove-dashboard", title: "Texprove sales dashboard", version: "1.0.0" };
const INSTRUCTIONS =
  "Texprove's sales outreach dashboard. The Google Sheet is the source of truth; n8n workflows find companies (WF0), research them (WF1), " +
  "draft first emails (WF2), send approved ones (WF3, weekdays 10:00 and 14:00 Istanbul), triage replies (WF4) and draft follow-ups (WF5). " +
  "Start with overview. Show the person the full email (get_lead) before approving it unless they asked to approve without reading. " +
  "While test mode is on, every email goes to the test inbox. Never go live (clear Test Email) unless the person clearly asks for it.";

type RpcId = string | number | null;
type RpcRequest = { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });

/** One JSON-RPC message -> response object, or null for a notification. */
export async function handleRpc(msg: RpcRequest, user: SessionUser): Promise<object | null> {
  const isNotification = msg.id === undefined;
  const id: RpcId = msg.id ?? null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNotification ? null : rpcError(id, -32600, "Invalid request");
  if (isNotification) return null;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !t.write, destructiveHint: Boolean(t.write), openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = findTool(name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Record<string, unknown>;
      if (tool.write && !rateLimit(user.email)) {
        return rpcResult(id, { content: [{ type: "text", text: "Too many changes in one minute. Wait a moment and try again." }], isError: true });
      }
      try {
        const r = await tool.run(user, args);
        console.log(JSON.stringify({ t: new Date().toISOString(), event: "mcp_tool", user: user.email, tool: name, ok: r.ok }));
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }], structuredContent: r.data, isError: !r.ok });
      } catch (err) {
        console.error(JSON.stringify({ t: new Date().toISOString(), event: "mcp_error", tool: name, error: String((err as Error)?.stack ?? err) }));
        return rpcResult(id, { content: [{ type: "text", text: "Something went wrong in the dashboard. Nothing was changed." }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Streamable HTTP POST body (one message or a batch) -> HTTP response. */
export async function handleMcpPost(req: Request, user: SessionUser): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
  const headers = { "Cache-Control": "no-store" };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m as RpcRequest, user)))).filter(Boolean);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
  }
  const out = await handleRpc(body as RpcRequest, user);
  return out ? Response.json(out, { headers }) : new Response(null, { status: 202, headers });
}
