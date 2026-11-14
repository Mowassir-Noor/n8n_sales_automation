// The `expect` block of a lead write (CONTRACT.md): the row as the user saw it. Pure; used by the page and the MCP tools.
import { hashFirst, hashFollowup } from "@shared/email";
import type { Expect, LeadAction, LeadRow } from "./types";

export const FIRST_ACTIONS: LeadAction[] = ["approve_first", "reject_first", "edit_first", "unapprove_first"];
export const FOLLOWUP_ACTIONS: LeadAction[] = ["approve_followup", "edit_followup", "rewrite_followup", "decline_followup"];

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
