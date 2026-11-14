import type { LeadRow, Settings, SuppressionRow } from '../../src/lib/types';

export type DraftStatus = 'OK' | 'Needs fix' | 'Blocked';

/** Rows may be partial (e.g. a draft being edited); missing fields count as "". */
type LeadLike = Partial<LeadRow>;
type SettingsLike = Partial<Settings>;
type SuppressionLike = Pick<SuppressionRow, 'Email' | 'Domain'> & Partial<SuppressionRow>;

export interface CheckDraftInput {
  subject: string;
  body: string;
  lead: LeadLike;
  settings: SettingsLike;
  suppression: SuppressionLike[];
}
export interface CheckDraftResult {
  status: DraftStatus;
  /** Reasons in node order; join with '; ' for the 'Compliance Notes' cell. */
  notes: string[];
  /** The body after fixAddressLineBreak(); this is what gets saved. */
  body: string;
}
export interface CheckFollowupInput {
  body: string;
  lead?: LeadLike;
  settings?: SettingsLike;
  suppression?: SuppressionLike[];
}
export interface CheckFollowupResult {
  ok: boolean;
  notes: string[];
}
export interface Recipient {
  /** Where the mail actually goes: Settings 'Test Email' when set, else the lead's Email. */
  to: string;
  /** The lead's own Email. */
  realTo: string;
  /** True while Settings 'Test Email' is set. */
  testMode: boolean;
}

/** Verbatim copy of WF3 'Build HTML'. */
export function buildHtml(body: string, settings: SettingsLike): string;
/** WF2 'Compliance check' (=> Blocked) + WF2 'Check Draft' (=> Needs fix) + "signature line not found". */
export function checkDraft(input: CheckDraftInput): CheckDraftResult;
/** WF2 'Check Draft' line break before "No:" after Sk./Sok./Cad./Cd./Bulv./Sokak/Sokağı/Caddesi/Bulvarı. */
export function fixAddressLineBreak(body: string): string;
/** WF2 'Compliance check' reasons for one lead (any reason => Blocked). */
export function complianceIssues(lead: LeadLike, suppression: SuppressionLike[]): string[];
/** Trade-secret rule from WF2 'Check Draft'. */
export function sensitiveIssues(text: string): string[];
/** WF5 'Check Follow-up' (+ opt-out/suppression from 'Follow-up due?'). */
export function checkFollowup(input: CheckFollowupInput): CheckFollowupResult;
/** Trade-secret rule from WF5 'Check Follow-up'. */
export function followupSensitiveIssues(text: string): string[];
export function recipientFor(lead: LeadLike, settings: SettingsLike): Recipient;
export function firstEmailSubject(lead: LeadLike): string;
/** 'Re: ' + Subject unless it already starts with "re:" (any case). */
export function followupSubject(lead: LeadLike): string;
/** WF3 'Safe to send?' suppression rule: exact email, or email domain equal to / subdomain of a suppressed domain. */
export function isSuppressed(email: string, suppression: SuppressionLike[]): boolean;
/** cyrb53 as 14 lowercase hex chars; null/undefined => "". */
export function hashText(s: string | null | undefined): string;
export function hashFirst(subject: string | null | undefined, body: string | null | undefined): string;
export function hashFollowup(text: string | null | undefined): string;
