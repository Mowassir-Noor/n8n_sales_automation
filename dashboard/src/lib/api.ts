// Shared plumbing for the app's route handlers: session/role, Origin check, rate limit, request log.
import type { z } from "zod";
import { auth } from "../auth";
import { env } from "./env";
import { roleFor } from "./roles";
import { originAllowed, rateLimit } from "./guards";
export { originAllowed, rateLimit, RATE_LIMIT } from "./guards";
import type { SessionUser } from "./types";

export type ErrorBody = { status: number; error?: string; errors?: string[] };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(status: number, error: string): Response {
  return json({ status, error }, status);
}

/** The signed-in user with the role re-read from the allowlists, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const e = env();
  const role = roleFor(email, { approverEmails: e.approverEmails, adminEmails: e.adminEmails });
  if (!role) return null;
  return { email: email.toLowerCase(), name: session.user?.name ?? undefined, role };
}

// ---- Request log (stdout, one JSON line; never draft text) -----------------

export function logRequest(entry: { user?: string; method: string; route: string; status: number; ms: number; action?: string; leadId?: string; note?: string }) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event: "request", ...entry }));
}

// ---- Wrappers -------------------------------------------------------------

export type GetCtx = { user: SessionUser; req: Request; url: URL };
export type PostCtx<T> = GetCtx & { body: T; log: { action?: string; leadId?: string; note?: string } };

/** GET wrapper: session required; logs the request. */
export function withUser(route: string, handler: (ctx: GetCtx) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const t0 = Date.now();
    let user: SessionUser | null = null;
    let res: Response;
    try {
      user = await currentUser();
      res = user ? await handler({ user, req, url: new URL(req.url) }) : errorResponse(401, "You are not signed in.");
    } catch (err) {
      console.error(JSON.stringify({ t: new Date().toISOString(), event: "route_error", route, error: String((err as Error)?.stack ?? err) }));
      res = errorResponse(500, "Something went wrong in the dashboard. Nothing was changed.");
    }
    logRequest({ user: user?.email, method: req.method, route, status: res.status, ms: Date.now() - t0 });
    return res;
  };
}

/**
 * POST wrapper: session, Origin check, rate limit, JSON + Zod validation, then the handler.
 * The handler does the role check, pre-checks, n8n call and cache invalidation.
 */
export function withWrite<S extends z.ZodType>(route: string, schema: S, handler: (ctx: PostCtx<z.infer<S>>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const t0 = Date.now();
    let user: SessionUser | null = null;
    const log: PostCtx<unknown>["log"] = {};
    let res: Response;
    try {
      const e = env();
      user = await currentUser();
      if (!user) res = errorResponse(401, "You are not signed in.");
      else if (!originAllowed(req, e.authUrl, e.isProduction)) res = errorResponse(403, "This request did not come from the dashboard page, so it was refused.");
      else if (!rateLimit(user.email)) res = errorResponse(429, "Too many changes in one minute. Wait a moment and try again.");
      else {
        let raw: unknown;
        try { raw = await req.json(); } catch { raw = undefined; }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          const errors = parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
          res = json({ status: 422, errors: errors.map((m) => `The request was not valid (${m}).`) }, 422);
        } else {
          res = await handler({ user, req, url: new URL(req.url), body: parsed.data, log });
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ t: new Date().toISOString(), event: "route_error", route, error: String((err as Error)?.stack ?? err) }));
      res = errorResponse(500, "Something went wrong in the dashboard. Nothing was changed.");
    }
    logRequest({ user: user?.email, method: req.method, route, status: res.status, ms: Date.now() - t0, ...log });
    return res;
  };
}

/** Sends an n8n result body back with the same HTTP status. */
export function relay(body: { status: number }): Response {
  return json(body, body.status);
}
