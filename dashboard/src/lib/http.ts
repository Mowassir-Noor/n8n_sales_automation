// Response helpers and the request log, without auth (so they can be imported by tests and the MCP server).

export type ErrorBody = { status: number; error?: string; errors?: string[] };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(status: number, error: string): Response {
  return json({ status, error }, status);
}

// ---- Request log (stdout, one JSON line; never draft text) -----------------

export function logRequest(entry: { user?: string; method: string; route: string; status: number; ms: number; action?: string; leadId?: string; note?: string }) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event: "request", ...entry }));
}

/** Sends an n8n result body back with the same HTTP status. */
export function relay(body: { status: number }): Response {
  return json(body, body.status);
}
