// Typed client for the n8n "DB - …" webhook API (CONTRACT.md, "n8n webhook API").
// POST ${N8N_INTERNAL_URL}/webhook/${dash|dash-staging}/<path>, header X-Dash-Key, 15 s timeout.
import { env } from "./env";
import type {
  LeadRow, LogPage, LogQuery, N8nLeadActionRequest, Role, Settings, SettingsWriteRequest, SocialRow,
  SocialWriteRequest, Snapshot, StatusResponse, SuppressionRow, SuppressionWriteRequest,
} from "./types";

export const N8N_TIMEOUT_MS = 15_000;

export type N8nPath = "snapshot" | "log" | "lead" | "settings" | "suppression" | "social" | "status";

/** Body sent back to the browser. Always carries `status` (same as the HTTP status). */
export type ApiBody =
  | ({ status: 200; ok: true } & Record<string, unknown>)
  | { status: 409; conflict: true; row: unknown; message: string }
  | { status: 422; errors: string[] }
  | { status: 401 | 403 | 429; error: string }
  | { status: 500 | 502 | 503; error: string };

export type Actor = { actor: string; actorRole: Role };

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...a) => fetch(...a);
/** Tests only. */
export function setFetch(f: FetchLike) { fetchImpl = f; }

export const MESSAGES = {
  conflict: "This changed since you opened it (in the sheet, by a workflow or by the other user). Nothing was saved. Look at the current version and try again.",
  timeout: "n8n did not answer within 15 seconds. The change may or may not have been saved; refresh, check, and try again (repeating the same click is safe).",
  unreachable: "The dashboard cannot reach n8n right now, so nothing was saved. Try again in a minute.",
  badKey: "n8n refused the dashboard's key (X-Dash-Key). Nothing was saved. The admin needs to check DASH_KEY and the n8n Header Auth credential.",
  notFound: "The n8n workflow for this action is not active (webhook not found). Nothing was saved. The admin needs to publish the DB workflows.",
  serverError: "n8n hit an error and nothing was saved",
  badResponse: "n8n sent an answer the dashboard does not understand. Refresh and check whether the change was saved.",
} as const;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Maps an n8n HTTP response (or failure) to the body the app returns. Exported for tests. */
export function mapN8nResponse(httpStatus: number, json: unknown): ApiBody {
  const o = isObj(json) ? json : {};
  if (httpStatus >= 200 && httpStatus < 300) {
    if (o.ok === true) return { ...o, status: 200, ok: true };
    // A 200 without ok:true: treat 409/422-shaped bodies as such (n8n set the wrong code), else unknown.
    if (o.conflict === true) return { status: 409, conflict: true, row: o.row ?? null, message: String(o.message || MESSAGES.conflict) };
    if (Array.isArray(o.errors)) return { status: 422, errors: o.errors.map(String) };
    return { status: 502, error: MESSAGES.badResponse };
  }
  if (httpStatus === 409) {
    return { status: 409, conflict: true, row: o.row ?? null, message: typeof o.message === "string" && o.message ? o.message : MESSAGES.conflict };
  }
  if (httpStatus === 422) {
    const errors = Array.isArray(o.errors) ? o.errors.map(String).filter(Boolean) : [];
    return { status: 422, errors: errors.length ? errors : ["n8n refused the change but did not say why."] };
  }
  if (httpStatus === 403 && typeof o.error === "string") {
    // The workflow's own role refusal: { error }
    return { status: 403, error: o.error };
  }
  if (httpStatus === 401 || httpStatus === 403) return { status: 502, error: MESSAGES.badKey };
  if (httpStatus === 404) return { status: 503, error: MESSAGES.notFound };
  const detail = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : "";
  return { status: 502, error: detail ? `${MESSAGES.serverError}: ${detail}` : `${MESSAGES.serverError}.` };
}

/** Low-level call. Never throws: network errors and timeouts come back as 503 bodies. */
export async function callN8n(path: N8nPath, body: unknown, opts: { timeoutMs?: number } = {}): Promise<ApiBody> {
  const e = env();
  const url = e.webhookBase + path;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? N8N_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Dash-Key": e.dashKey },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
      cache: "no-store",
    });
    return mapN8nResponse(res.status, await readJson(res));
  } catch (err) {
    if (ctl.signal.aborted) return { status: 503, error: MESSAGES.timeout };
    console.error(JSON.stringify({ t: new Date().toISOString(), event: "n8n_unreachable", path, error: String((err as Error)?.message ?? err) }));
    return { status: 503, error: MESSAGES.unreachable };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Typed wrappers -------------------------------------------------------

export type Ok<K extends string, T> = { status: 200; ok: true } & { [P in K]: T };
export type Fail = Exclude<ApiBody, { status: 200 }>;

export const getSnapshot = () => callN8n("snapshot", {}) as Promise<(Snapshot & { status: 200 }) | Fail>;
export const getLog = (q: LogQuery) => callN8n("log", q) as Promise<(LogPage & { status: 200 }) | Fail>;
export const getStatus = () => callN8n("status", {}) as Promise<(StatusResponse & { status: 200 }) | Fail>;
export const postLeadAction = (req: N8nLeadActionRequest) =>
  callN8n("lead", req) as Promise<Ok<"row", LeadRow> | Fail>;
export const postSettings = (req: SettingsWriteRequest & Actor) =>
  callN8n("settings", req) as Promise<Ok<"settings", Settings> | Fail>;
export const postSuppression = (req: SuppressionWriteRequest & Actor) =>
  callN8n("suppression", req) as Promise<Ok<"suppression", SuppressionRow[]> | Fail>;
export const postSocial = (req: SocialWriteRequest & Actor) =>
  callN8n("social", req) as Promise<Ok<"row", SocialRow> | Fail>;
