"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Expect, LeadAction, LeadActionRequest, LeadRow } from "@/lib/types";
import { hashFirst, hashFollowup } from "@shared/email";
import { newRequestId, postJson, SNAPSHOT_KEY, useMe, useSnapshot, useStatus, type SnapshotResponse } from "./api";
import { useFeedback } from "./feedback";

const FIRST_ACTIONS: LeadAction[] = ["approve_first", "reject_first", "edit_first", "unapprove_first"];
const FOLLOWUP_ACTIONS: LeadAction[] = ["approve_followup", "edit_followup", "rewrite_followup", "decline_followup"];

/** The row as the user saw it (CONTRACT.md `expect` check). */
export function expectFor(lead: LeadRow, action: LeadAction): Expect {
  let draftHash = "";
  if (FIRST_ACTIONS.includes(action)) draftHash = hashFirst(lead.Subject, lead["Draft Body"]);
  else if (FOLLOWUP_ACTIONS.includes(action)) draftHash = hashFollowup(lead["Follow-up Draft"]);
  return {
    lastUpdated: lead["Last Updated"] ?? "",
    stage: lead.Stage ?? "",
    approved: lead.Approved ?? "",
    draftHash,
  };
}

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

export function useLeadAction() {
  const fb = useFeedback();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (lead: LeadRow, action: LeadAction, data: LeadActionRequest["data"] = {}, success?: string): Promise<LeadRow | null> => {
      const key = `${lead["Lead ID"]}:${action}`;
      setBusy(key);
      try {
        const req: LeadActionRequest = {
          action,
          leadId: lead["Lead ID"],
          expect: expectFor(lead, action),
          data,
          requestId: newRequestId(),
        };
        const res = await postJson("/api/lead-action", req);
        const ok = fb.handle(res, { success, mine: lead as unknown as Record<string, unknown> });
        if (ok) {
          const row = (res.body.row as LeadRow | undefined) ?? null;
          if (row) {
            qc.setQueryData<SnapshotResponse>(SNAPSHOT_KEY, (old) =>
              old ? { ...old, leads: old.leads.map((l) => (l["Lead ID"] === row["Lead ID"] ? { ...l, ...row } : l)) } : old,
            );
          }
          void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
          return row ?? lead;
        }
        if (res.status === 409) void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [fb, qc],
  );

  const isBusy = useCallback((lead: LeadRow | undefined, action?: LeadAction) => {
    if (!busy || !lead) return false;
    return action ? busy === `${lead["Lead ID"]}:${action}` : busy.startsWith(`${lead["Lead ID"]}:`);
  }, [busy]);

  return { run, busy, isBusy };
}
