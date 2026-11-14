// Zod schemas for the app API request bodies. Safe to import in the browser too.
import { z } from "zod";
import { SETTINGS_HEADERS } from "./types";

const MAX_TEXT = 20_000;
const text = (max = MAX_TEXT) => z.string().max(max);
export const requestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "requestId must be a uuid-like string");

export const leadActionSchema = z.object({
  action: z.enum([
    "approve_first", "reject_first", "edit_first", "unapprove_first",
    "approve_followup", "edit_followup", "rewrite_followup", "decline_followup",
    "opt_out", "set_reply_category", "mark_hot_handled", "reset_test_sent", "close_test_sent",
  ]),
  leadId: z.string().trim().min(1).max(50),
  expect: z.object({
    lastUpdated: text(100),
    stage: text(100),
    approved: text(50),
    draftHash: text(100),
  }),
  data: z.object({
    subject: text(500).optional(),
    body: text().optional(),
    note: text(2000).optional(),
    category: z.enum(["Hot", "Warm", "Cold", "Not interested"]).optional(),
  }).default({}),
  requestId,
});

const settingsPartial = z.partialRecord(z.enum(SETTINGS_HEADERS), text(2000));

export const settingsWriteSchema = z.object({
  expect: settingsPartial,
  data: settingsPartial,
  requestId,
});

export const suppressionWriteSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    data: z.object({
      Email: z.string().trim().toLowerCase().max(320).optional(),
      Domain: z.string().trim().toLowerCase().max(253).optional(),
      Reason: z.string().trim().min(1, "Give a reason").max(500),
    }).refine((d) => Boolean(d.Email) !== Boolean(d.Domain), "Give either an email address or a domain, not both."),
    requestId,
  }),
  z.object({
    action: z.literal("remove"),
    rowNumber: z.number().int().min(2),
    expect: z.object({ Email: text(320), Domain: text(253) }),
    reason: z.string().trim().min(1, "Give a reason for removing the row").max(500),
    requestId,
  }),
]);

export const socialWriteSchema = z.object({
  rowNumber: z.number().int().min(2),
  expect: z.object({ Week: text(100), Topic: text(500), draftHash: text(100) }),
  data: z.object({
    Approved: z.enum(["Pending", "Yes", "No", "Edit"]).optional(),
    "Nil Notes": text(2000).optional(),
    Posted: z.enum(["Yes", "No"]).optional(),
  }).refine((d) => Object.keys(d).length > 0, "Nothing to save."),
  requestId,
});

const intParam = (min: number, max: number) =>
  z.preprocess((x) => (x === undefined || x === "" ? undefined : Number(x)), z.number().int().min(min).max(max).optional());

export const logQuerySchema = z.object({
  leadId: z.string().trim().max(50).optional(),
  workflow: z.string().trim().max(100).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: intParam(1, 100_000),
  pageSize: intParam(1, 200),
});

/** Email/domain format checks for Suppression add (plain sentences). */
export function suppressionAddErrors(d: { Email?: string; Domain?: string }): string[] {
  const errs: string[] = [];
  if (d.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.Email)) errs.push("That is not a valid email address.");
  if (d.Domain && !/^@?([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d.Domain)) errs.push("That is not a valid domain (for example: example.com).");
  return errs;
}
