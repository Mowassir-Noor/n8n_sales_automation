// 20 s in-memory cache of the n8n `snapshot` response. Dropped after every write.
// When n8n fails, serve the last good snapshot with `stale: true, ageSeconds`.
import { getSnapshot } from "./n8n";
import type { Fail } from "./n8n";
import type { Snapshot } from "./types";

export const SNAPSHOT_TTL_MS = 20_000;

export type SnapshotResult =
  | { status: 200; body: Snapshot & { stale?: boolean; ageSeconds?: number } }
  | { status: 502 | 503; body: { status: 502 | 503; error: string } };

type State = { last: Snapshot | null; at: number; fresh: boolean; inflight: Promise<SnapshotResult> | null; gen: number };

// On globalThis so every route bundle in the process shares one cache.
const KEY = Symbol.for("texprove.dashboard.snapshot");
const g = globalThis as unknown as Record<symbol, State>;
const state: State = (g[KEY] ??= { last: null, at: 0, fresh: false, inflight: null, gen: 0 });

type Loader = () => Promise<(Snapshot & { status: 200 }) | Fail>;
let loader: Loader = getSnapshot;
/** Tests only. */
export function setSnapshotLoader(l: Loader) { loader = l; }
/** Tests only. */
export function resetSnapshotCache() { state.last = null; state.at = 0; state.fresh = false; state.inflight = null; state.gen++; }

/** Drop the cache so the next read goes to n8n (call after any write). The last snapshot stays as a stale fallback. */
export function invalidate() {
  state.fresh = false;
  state.inflight = null;
  state.gen++;
}

function isSnapshot(v: unknown): v is Snapshot {
  const o = v as Snapshot;
  return !!o && o.ok === true && Array.isArray(o.leads) && typeof o.settings === "object" && o.settings !== null
    && Array.isArray(o.suppression) && Array.isArray(o.social);
}

const ageOf = (now: number) => Math.max(0, Math.round((now - state.at) / 1000));

async function load(): Promise<SnapshotResult> {
  const gen = state.gen;
  const res = await loader();
  const now = Date.now();
  if (res.status === 200 && isSnapshot(res)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status: _s, ...snap } = res as Snapshot & { status: 200 };
    if (gen === state.gen) { state.last = snap; state.at = now; state.fresh = true; }
    return { status: 200, body: snap };
  }
  const error = "error" in res && typeof res.error === "string" ? res.error : "n8n sent a snapshot the dashboard does not understand.";
  console.error(JSON.stringify({ t: new Date().toISOString(), event: "snapshot_failed", status: res.status, error }));
  if (state.last) return { status: 200, body: { ...state.last, stale: true, ageSeconds: ageOf(now) } };
  return { status: 503, body: { status: 503, error: `The sheet data cannot be loaded right now. ${error}` } };
}

/** Cached snapshot (≤ 20 s old) unless `fresh`. Concurrent callers share one n8n request. */
export async function readSnapshot(opts: { fresh?: boolean } = {}): Promise<SnapshotResult> {
  const now = Date.now();
  if (!opts.fresh && state.fresh && state.last && now - state.at < SNAPSHOT_TTL_MS) {
    return { status: 200, body: state.last };
  }
  if (!state.inflight) {
    const p = load().finally(() => { if (state.inflight === p) state.inflight = null; });
    state.inflight = p;
  }
  return state.inflight;
}
