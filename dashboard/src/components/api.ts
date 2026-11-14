"use client";

// Browser-side access to the app's HTTP API (CONTRACT.md "App HTTP API").
// Pages never talk to n8n; they only use these hooks.
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { LogPage, LogQuery, SessionUser, Snapshot, StatusResponse } from "@/lib/types";

export type SnapshotResponse = Snapshot & { stale?: boolean; ageSeconds?: number };

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

function goSignIn() {
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/signin")) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/signin?callbackUrl=${back}`;
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 401) {
    goSignIn();
    throw new ApiError(401, body, "Signed out");
  }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string")
      ? (body as { error: string }).error
      : undefined;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

export type PostResult = { status: number; body: Record<string, unknown> };

export async function postJson(url: string, payload: unknown, headers?: Record<string, string>): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: 0, body: { error: "Network error: the dashboard server could not be reached." } };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { error: `Unexpected response (${res.status})` };
  }
  if (res.status === 401) goSignIn();
  return { status: res.status, body };
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Very old browsers only; the server dedupes on this id.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ---- Queries --------------------------------------------------------------

export const SNAPSHOT_KEY = ["snapshot"] as const;

export function useSnapshot(opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => getJson<SnapshotResponse>("/api/snapshot"),
    refetchInterval: opts?.poll === false ? false : 30_000,
    staleTime: 10_000,
  });
}

export function useRefreshSnapshot() {
  const qc = useQueryClient();
  return () =>
    qc.fetchQuery({
      queryKey: SNAPSHOT_KEY,
      queryFn: () => getJson<SnapshotResponse>("/api/snapshot?fresh=1"),
      staleTime: 0,
    });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<SessionUser>("/api/me"),
    staleTime: 5 * 60_000,
  });
}

export function useStatus(opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => getJson<StatusResponse>("/api/status"),
    refetchInterval: opts?.poll === false ? false : 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

export function logUrl(q: LogQuery): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `/api/log?${s}` : "/api/log";
}

export function useLog(q: LogQuery, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["log", q],
    queryFn: () => getJson<LogPage>(logUrl(q)),
    placeholderData: keepPreviousData,
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  });
}
