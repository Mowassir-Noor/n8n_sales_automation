// Liveness probe for Docker/Caddy. No auth, no n8n call.

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
