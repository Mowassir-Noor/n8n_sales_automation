"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LeadAction, LeadActionRequest, LeadRow } from "@/lib/types";
import { expectFor } from "@/lib/expect";
import { newRequestId, postJson, SNAPSHOT_KEY, useMe, useSnapshot, useStatus, type PostResult, type SnapshotResponse } from "./api";
import { useFeedback } from "./feedback";
import { SOFT_CAPS, hubspotContactUrl } from "./derive";

export { expectFor };

/** Why writes are disabled right now (stale snapshot, header mismatch, no data), or null. */
export function useWriteGuard(): { disabled: boolean; reason: string | null } {
  const { data } = useSnapshot();
  if (!data) return { disabled: true, reason: "Data is still loading." };
  if (data.stale) return { disabled: true, reason: "The data is out of date because n8n is not answering. Changes are disabled." };
  if (!data.headersOk) return { disabled: true, reason: "The sheet's columns do not match. Changes are disabled." };
  return { disabled: false, reason: null };
}

export function useRole() {
  const me = useMe();
  return { role: me.data?.role, isAdmin: me.data?.role === "admin", me: me.data };
}

export function useWf3Running(): boolean {
  const { data } = useStatus();
  return !!data?.running?.wf3;
}
export function useWf5Running(): boolean {
  const { data } = useStatus();
  return !!data?.running?.wf5;
}

export type SendResult = { ok: boolean; row: LeadRow | null; res: PostResult };

export function useLeadAction() {
  const fb = useFeedback();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  /** One request, no toasts or dialogs. refresh: false skips the snapshot re-fetch (bulk runs do it once at the end). */
  const send = useCallback(
    async (
      lead: LeadRow,
      action: LeadAction,
      data: LeadActionRequest["data"] = {},
      opts: { requestId?: string; refresh?: boolean } = {},
    ): Promise<SendResult> => {
      const req: LeadActionRequest = {
        action,
        leadId: lead["Lead ID"],
        expect: expectFor(lead, action),
        data,
        requestId: opts.requestId ?? newRequestId(),
      };
      const res = await postJson("/api/lead-action", req);
      const b = res.body ?? {};
      if (res.status >= 200 && res.status < 300 && b.ok !== false) {
        const row = (b.row as LeadRow | undefined) ?? null;
        if (row) {
          qc.setQueryData<SnapshotResponse>(SNAPSHOT_KEY, (old) =>
            old ? { ...old, leads: old.leads.map((l) => (l["Lead ID"] === row["Lead ID"] ? { ...l, ...row } : l)) } : old,
          );
        }
        if (opts.refresh !== false) void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
        return { ok: true, row: row ?? lead, res };
      }
      if (res.status === 409 && opts.refresh !== false) void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      return { ok: false, row: null, res };
    },
    [qc],
  );

  const run = useCallback(
    async (lead: LeadRow, action: LeadAction, data: LeadActionRequest["data"] = {}, success?: string): Promise<LeadRow | null> => {
      const key = `${lead["Lead ID"]}:${action}`;
      setBusy(key);
      try {
        const r = await send(lead, action, data);
        return fb.handle(r.res, { success, mine: lead as unknown as Record<string, unknown> }) ? r.row : null;
      } finally {
        setBusy(null);
      }
    },
    [fb, send],
  );

  const isBusy = useCallback((lead: LeadRow | undefined, action?: LeadAction) => {
    if (!busy || !lead) return false;
    return action ? busy === `${lead["Lead ID"]}:${action}` : busy.startsWith(`${lead["Lead ID"]}:`);
  }, [busy]);

  return { run, send, busy, isBusy };
}

// ---- "Approve all" -----------------------------------------------------------
// Google Sheets allows 60 read requests per minute for the whole project (n8n's DB and WF workflows
// share it), and one approval costs about five reads in n8n. So bulk runs go one lead at a time with a
// short pause, and when Google (or the dashboard) says "busy" they wait and retry the same lead with
// the same requestId (safe: n8n answers a repeated id from its dedupe store if the first try did land).
export const BULK_PAUSE_MS = 3_000;
export const BULK_RETRY_WAITS_MS = [20_000, 40_000, 60_000];

/** Busy answers worth waiting for: Google quota (429), sheet unreadable / n8n timeout (503), network. */
export function isRetryable(res: PostResult): boolean {
  return res.status === 429 || res.status === 503 || res.status === 0;
}

export type BulkProgress = { done: number; total: number; waitSeconds?: number };
export type BulkOutcome = { ok: number; total: number; failed: { lead: LeadRow; res: PostResult } | null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useBulkLeadAction(opts: { pauseMs?: number; retryWaitsMs?: number[] } = {}) {
  const { send } = useLeadAction();
  const qc = useQueryClient();
  const fb = useFeedback();
  const pauseMs = opts.pauseMs ?? BULK_PAUSE_MS;
  const waits = opts.retryWaitsMs ?? BULK_RETRY_WAITS_MS;

  return useCallback(
    async (items: LeadRow[], action: LeadAction, onProgress: (p: BulkProgress) => void): Promise<BulkOutcome> => {
      const total = items.length;
      let ok = 0;
      let failed: BulkOutcome["failed"] = null;
      onProgress({ done: 0, total });
      try {
        for (let i = 0; i < total; i++) {
          if (i > 0) await sleep(pauseMs);
          const requestId = newRequestId();
          let r = await send(items[i], action, {}, { requestId, refresh: false });
          for (let a = 0; !r.ok && isRetryable(r.res) && a < waits.length; a++) {
            onProgress({ done: i, total, waitSeconds: Math.round(waits[a] / 1000) });
            await sleep(waits[a]);
            onProgress({ done: i, total });
            r = await send(items[i], action, {}, { requestId, refresh: false });
          }
          if (!r.ok) {
            failed = { lead: items[i], res: r.res };
            break;
          }
          ok++;
          onProgress({ done: i + 1, total });
        }
      } finally {
        void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      }
      // A conflict or a rule refusal gets the usual dialog; other errors go in the summary.
      if (failed && (failed.res.status === 409 || failed.res.status === 422)) {
        fb.handle(failed.res, { mine: failed.lead as unknown as Record<string, unknown> });
      }
      return { ok, total, failed };
    },
    [send, qc, fb, pauseMs, waits],
  );
}

/** Text for the end of a bulk run. */
export function bulkSummary(o: BulkOutcome, noun: string): { text: string; kind: "ok" | "danger" } {
  if (!o.failed) return { text: `${o.ok} of ${o.total} ${noun} approved.`, kind: "ok" };
  const b = o.failed.res.body ?? {};
  const why = typeof b.error === "string" ? b.error
    : typeof b.message === "string" ? b.message
    : Array.isArray(b.errors) ? (b.errors as unknown[]).map(String).join(" ")
    : o.failed.res.status === 0 ? "the dashboard server could not be reached."
    : `HTTP ${o.failed.res.status}`;
  const saved = o.ok ? `The ${o.ok} before it ${o.ok === 1 ? "is" : "are"} approved and saved. ` : "";
  return {
    text: `${o.ok} of ${o.total} ${noun} approved, then it stopped at ${o.failed.lead.Company || o.failed.lead["Lead ID"]} (${o.failed.lead["Lead ID"]}): ${why} ${saved}Press Approve all again for the rest.`,
    kind: "danger",
  };
}

/** Soft caps from the server env (WEEKLY_FIRST_EMAIL_CAP, DAILY_WARMUP_CAP) via /api/me; plan defaults as fallback. */
export function useSoftCaps(): { weekly: number; daily: number } {
  const cfg = useMe().data?.config;
  return {
    weekly: Number(cfg?.weeklyFirstEmailCap) > 0 ? Number(cfg?.weeklyFirstEmailCap) : SOFT_CAPS.weekly,
    daily: Number(cfg?.dailyWarmupCap) > 0 ? Number(cfg?.dailyWarmupCap) : SOFT_CAPS.daily,
  };
}

/** "Open in HubSpot" URL for a lead, when HUBSPOT_PORTAL_ID is configured and the lead has a contact ID. */
export function useHubspotUrl(contactId: string | undefined): string | null {
  const portal = useMe().data?.config?.hubspotPortalId;
  return hubspotContactUrl(portal, contactId);
}
