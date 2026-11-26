"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LeadRow } from "@/lib/types";
import { checkDraft, firstEmailSubject, isSuppressed } from "@shared/email";
import type { SnapshotResponse } from "@/components/api";
import { useLeadAction, useRole, useSoftCaps, useWf3Running, useWriteGuard } from "@/components/actions";
import { ComplianceBadge } from "@/components/badges";
import { ago, capStatus, fmtDateTimeIst, fmtRun, languageFlag, type FirstEmailTab } from "@/components/derive";
import { HtmlPreview, MailHeader, PlainTextPreview } from "@/components/EmailPreview";
import { Badge, Button, DataList, Dialog, Field, Notice, Tabs, TabPanel, inputClass, isTypingTarget } from "@/components/ui";

const T = {
  tabs: { preview: "Preview", plain: "Plain text", english: "English", why: "Why this lead", checks: "Checks" },
  detailTabs: "Draft views",
  approve: "Approve",
  edit: "Edit",
  reject: "Reject",
  unapprove: "Un-approve",
  skip: "Skip",
  back: "Back",
  adminWarn: "Nil's plan says she approves; this will be logged as approved by admin.",
  approveOff: {
    writes: "",
    live: "Approve is off: the live re-check is not OK.",
    sheet: (s: string) => `Approve is off: the sheet's Compliance Status is "${s || "empty"}". Edit and save the draft to re-check it.`,
    blocked: "Approve is off: this lead opted out or is on the suppression list.",
  },
  editOffApproved: "Un-approve first to edit.",
  sendingNow: "Already being sent: WF3 is running now.",
  sendsAt: (t: string) => `Approved. Sends at the next WF3 run: ${t}.`,
  rejected: "Rejected",
  waited: (t: string) => `Waiting ${t}`,
  englishNone: "No English reference for this draft.",
  englishCleared: "The English reference was cleared when the draft was edited (no re-translation, to save API credit).",
  englishNote: "Reference only, not sent.",
  englishTr: "This is the English translation of a Turkish draft.",
  blockedLead: "This lead opted out or is on the suppression list. WF3 will not send it.",
  nilNotes: "Nil Notes",
  checksSheet: "On the sheet (from WF2 or the last edit)",
  checksLive: "Live re-check (same rules as WF2 'Check Draft')",
  checksOk: "All checks pass.",
  status: "Status",
  notes: "Notes",
  // edit
  editTitle: "Edit draft",
  subject: "Subject",
  body: "Body",
  save: "Save",
  cancel: "Cancel",
  saveNote: "Saving re-checks the draft and keeps it waiting. Approving is a separate click.",
  saved: "Draft saved. Review it, then approve.",
  addressFix: "The street-address line break will be fixed on save (as WF2 does).",
  unsavedLeave: "Discard your changes?",
  // reject
  rejectTitle: "Reject this draft",
  rejectReason: "Reason (saved in Nil Notes)",
  rejectHelp: "Required. WF2 does not rewrite rejected drafts; the reason is for the record.",
  rejectConfirm: "Reject",
  rejectedToast: "Draft rejected.",
  approvedToast: "Approved. It sends at the next WF3 run.",
  unapprovedToast: "Moved back to Waiting.",
  capTitle: "Approve past the planned pace?",
  approveAnyway: "Approve anyway",
  why: {
    research: "Research Notes",
    hook: "Personalisation Hook",
    source: "Source",
    sourceDate: "Source Date",
    confidence: "Confidence",
    contact: "Contact",
    title: "Title",
    linkedin: "LinkedIn",
    website: "Website",
    segment: "Segment",
    country: "Country",
  },
  openLead: "Open lead",
};

type DetailTab = keyof typeof T.tabs;

export type DetailCommands = { approve?: () => void; edit?: () => void; reject?: () => void };

function ExternalLink({ href }: { href: string }) {
  const ok = /^https?:\/\//i.test(href.trim());
  if (!ok) return <span>{href}</span>;
  return (
    <a href={href.trim()} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline-offset-2 hover:underline">
      {href.trim()}
    </a>
  );
}

export function FirstEmailDetail({
  lead,
  tab,
  snapshot,
  now,
  sendAt,
  onDone,
  onSkip,
  onBack,
  backLabel,
}: {
  lead: LeadRow;
  tab: FirstEmailTab;
  snapshot: SnapshotResponse;
  now: Date;
  sendAt?: Date;
  onDone: () => void;
  onSkip: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const { settings, suppression } = snapshot;
  const guard = useWriteGuard();
  const { isAdmin } = useRole();
  const wf3Running = useWf3Running();
  const caps = useSoftCaps();
  const { run, isBusy } = useLeadAction();
  const ids = useId();

  const [view, setView] = useState<DetailTab>("preview");
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(lead.Subject);
  const [body, setBody] = useState(lead["Draft Body"]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [capOpen, setCapOpen] = useState<string[] | null>(null);

  // Live re-check of the saved text (or the text being edited).
  const live = useMemo(
    () => checkDraft({ subject: editing ? subject : lead.Subject, body: editing ? body : lead["Draft Body"], lead, settings, suppression }),
    [editing, subject, body, lead, settings, suppression],
  );
  const savedLive = useMemo(
    () => checkDraft({ subject: lead.Subject, body: lead["Draft Body"], lead, settings, suppression }),
    [lead, settings, suppression],
  );

  const blockedLead = (lead["Opt-out"] || "").trim() === "Yes" || isSuppressed(lead.Email, suppression);
  const sheetStatus = (lead["Compliance Status"] || "").trim();

  let approveOff: string | null = null;
  if (guard.disabled) approveOff = guard.reason;
  else if (blockedLead) approveOff = T.approveOff.blocked;
  else if (savedLive.status !== "OK") approveOff = T.approveOff.live;
  else if (sheetStatus !== "OK") approveOff = T.approveOff.sheet(sheetStatus);

  const canApprove = tab === "waiting" && !approveOff && !editing;
  const canEdit = tab !== "approved" && !guard.disabled && !editing;
  const canReject = tab !== "rejected" && tab !== "approved" && !guard.disabled && !editing;
  const canUnapprove = tab === "approved" && !guard.disabled && !wf3Running;

  const doApprove = async (force = false) => {
    if (!canApprove) return;
    const warnings = capStatus(snapshot.leads, caps, now, 1).warnings;
    if (warnings.length && !force) {
      setCapOpen(warnings);
      return;
    }
    setCapOpen(null);
    const row = await run(lead, "approve_first", {}, T.approvedToast);
    if (row) onDone();
  };
  const startEdit = () => {
    if (!canEdit) return;
    setSubject(lead.Subject);
    setBody(lead["Draft Body"]);
    setEditing(true);
  };
  const doSave = async () => {
    const row = await run(lead, "edit_first", { subject, body }, T.saved);
    if (row) {
      setEditing(false);
      setView("preview");
    }
  };
  const doReject = async () => {
    if (!reason.trim()) return;
    const row = await run(lead, "reject_first", { note: reason.trim() }, T.rejectedToast);
    if (row) {
      setRejectOpen(false);
      setReason("");
      onDone();
    }
  };
  const doUnapprove = async () => {
    const row = await run(lead, "unapprove_first", {}, T.unapprovedToast);
    if (row) onDone();
  };

  // Keyboard: A approve, E edit, R reject (J/K live in the queue).
  const keys = useRef<DetailCommands>({});
  useEffect(() => {
    keys.current = {
      approve: canApprove ? () => void doApprove() : undefined,
      edit: canEdit ? startEdit : undefined,
      reject: canReject ? () => setRejectOpen(true) : undefined,
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const fn = ({ a: keys.current.approve, e: keys.current.edit, r: keys.current.reject } as Record<string, (() => void) | undefined>)[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const previewBody = editing ? live.body : lead["Draft Body"];
  const previewSubject = editing ? subject : firstEmailSubject(lead);
  const dirty = editing && (subject !== lead.Subject || body !== lead["Draft Body"]);
  const isTr = (lead.Language || "").toLowerCase() === "tr";

  return (
    <article className="rounded-lg border border-line bg-surface" aria-labelledby={`${ids}-h`}>
      {/* Header */}
      <div className="border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} className="mb-2 text-sm font-medium text-accent lg:hidden">
          ← {backLabel}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={`${ids}-h`} className="text-lg font-semibold leading-tight">
              {lead.Company} <span className="text-sm font-normal text-muted">{lead["Lead ID"]}</span>
            </h2>
            <p className="text-muted">
              {languageFlag(lead.Language)} {lead["Contact Name"] || "-"}
              {lead["Contact Title"] ? `, ${lead["Contact Title"]}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ComplianceBadge status={lead["Compliance Status"]} />
            {tab === "waiting" ? <Badge>{T.waited(ago(lead["Last Updated"], now))}</Badge> : null}
            {tab === "rejected" ? <Badge tone="danger">{T.rejected}</Badge> : null}
            <Link href={`/leads/${encodeURIComponent(lead["Lead ID"])}`} className="text-xs font-medium text-accent hover:underline">
              {T.openLead}
            </Link>
          </div>
        </div>
        {tab === "approved" && sendAt ? (
          <Notice tone="ok" className="mt-2">
            {T.sendsAt(fmtRun(sendAt, now))}
          </Notice>
        ) : null}
        {blockedLead ? (
          <Notice tone="danger" className="mt-2">
            {T.blockedLead}
          </Notice>
        ) : null}
        {lead["Nil Notes"] ? (
          <p className="mt-2 text-sm">
            <span className="font-medium">{T.nilNotes}: </span>
            <span className="whitespace-pre-wrap">{lead["Nil Notes"]}</span>
          </p>
        ) : null}
      </div>

      {/* Actions */}
      {!editing ? (
        <div className="border-b border-line px-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {tab === "waiting" ? (
              <Button variant="ok" disabled={!canApprove} busy={isBusy(lead, "approve_first")} onClick={() => void doApprove()} aria-keyshortcuts="A">
                {T.approve}
              </Button>
            ) : null}
            {tab === "approved" ? (
              <Button
                variant="secondary"
                disabled={!canUnapprove}
                busy={isBusy(lead, "unapprove_first")}
                onClick={() => void doUnapprove()}
                title={wf3Running ? T.sendingNow : undefined}
              >
                {T.unapprove}
              </Button>
            ) : null}
            <Button disabled={!canEdit} onClick={startEdit} aria-keyshortcuts="E" title={tab === "approved" ? T.editOffApproved : undefined}>
              {T.edit}
            </Button>
            {tab !== "rejected" && tab !== "approved" ? (
              <Button variant="danger" disabled={!canReject} onClick={() => setRejectOpen(true)} aria-keyshortcuts="R">
                {T.reject}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onSkip} aria-keyshortcuts="J">
              {T.skip}
            </Button>
          </div>
          {tab === "waiting" && approveOff ? <p className="mt-1.5 text-xs text-muted">{approveOff}</p> : null}
          {tab === "approved" && wf3Running ? <p className="mt-1.5 text-xs text-warn">{T.sendingNow}</p> : null}
          {tab === "approved" ? <p className="mt-1.5 text-xs text-muted">{T.editOffApproved}</p> : null}
          {tab === "waiting" && isAdmin && canApprove ? <p className="mt-1.5 text-xs text-warn">{T.adminWarn}</p> : null}
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <div className="space-y-3">
            <h3 className="font-semibold">{T.editTitle}</h3>
            <Field label={T.subject} htmlFor={`${ids}-subj`}>
              <input id={`${ids}-subj`} className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label={T.body} htmlFor={`${ids}-body`}>
              <textarea
                id={`${ids}-body`}
                className={`${inputClass} min-h-[360px] font-mono text-[13px] leading-relaxed`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            {live.body !== body ? <p className="text-xs text-muted">{T.addressFix}</p> : null}
            <CheckResult status={live.status} notes={live.notes} title={T.checksLive} />
            <p className="text-xs text-muted">{T.saveNote}</p>
            {isAdmin ? <p className="text-xs text-warn">{T.adminWarn}</p> : null}
            <div className="flex gap-2">
              <Button variant="primary" disabled={!dirty || guard.disabled} busy={isBusy(lead, "edit_first")} onClick={() => void doSave()}>
                {T.save}
              </Button>
              <Button
                onClick={() => {
                  if (!dirty || window.confirm(T.unsavedLeave)) setEditing(false);
                }}
              >
                {T.cancel}
              </Button>
            </div>
          </div>
          <div className="min-w-0 overflow-hidden rounded-lg border border-line">
            <MailHeader lead={lead} settings={settings} subject={previewSubject} />
            <HtmlPreview body={previewBody} settings={settings} height={480} />
          </div>
        </div>
      ) : (
        <>
          <Tabs
            idBase={`${ids}-v`}
            label={T.detailTabs}
            value={view}
            onChange={setView}
            className="px-2"
            items={(Object.keys(T.tabs) as DetailTab[]).map((k) => ({ key: k, label: T.tabs[k] }))}
          />
          <TabPanel idBase={`${ids}-v`} value={view}>
            {view === "preview" ? (
              <>
                <MailHeader lead={lead} settings={settings} subject={previewSubject} />
                <HtmlPreview body={previewBody} settings={settings} />
              </>
            ) : null}
            {view === "plain" ? (
              <>
                <MailHeader lead={lead} settings={settings} subject={previewSubject} />
                <PlainTextPreview text={lead["Draft Body"]} />
              </>
            ) : null}
            {view === "english" ? (
              <div className="p-4">
                <Notice tone="accent" className="mb-3">
                  {T.englishNote} {isTr ? T.englishTr : ""}
                </Notice>
                {lead["Draft Body EN"] ? (
                  <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{lead["Draft Body EN"]}</pre>
                ) : (
                  <p className="text-muted">{isTr ? T.englishCleared : T.englishNone}</p>
                )}
              </div>
            ) : null}
            {view === "why" ? (
              <div className="p-4">
                <DataList
                  items={[
                    [T.why.research, lead["Research Notes"]],
                    [T.why.hook, lead["Personalisation Hook"]],
                    [T.why.source, lead["Source URL"] ? <ExternalLink href={lead["Source URL"]} /> : ""],
                    [T.why.sourceDate, lead["Source Date"]],
                    [T.why.confidence, lead.Confidence],
                    [T.why.contact, lead["Contact Name"]],
                    [T.why.title, lead["Contact Title"]],
                    [T.why.linkedin, lead.LinkedIn ? <ExternalLink href={lead.LinkedIn} /> : ""],
                    [T.why.website, lead.Website ? <ExternalLink href={lead.Website} /> : ""],
                    [T.why.segment, lead.Segment],
                    [T.why.country, lead.Country],
                  ]}
                />
              </div>
            ) : null}
            {view === "checks" ? (
              <div className="space-y-4 p-4">
                <div>
                  <h3 className="mb-1 text-sm font-semibold">{T.checksSheet}</h3>
                  <DataList
                    items={[
                      [T.status, <ComplianceBadge key="s" status={lead["Compliance Status"]} />],
                      [T.notes, lead["Compliance Notes"]],
                      ["Last Updated", fmtDateTimeIst(lead["Last Updated"])],
                    ]}
                  />
                </div>
                <CheckResult status={savedLive.status} notes={savedLive.notes} title={T.checksLive} />
              </div>
            ) : null}
          </TabPanel>
        </>
      )}

      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={T.rejectTitle}
        footer={
          <>
            <Button onClick={() => setRejectOpen(false)}>{T.cancel}</Button>
            <Button variant="danger" disabled={!reason.trim() || guard.disabled} busy={isBusy(lead, "reject_first")} onClick={() => void doReject()}>
              {T.rejectConfirm}
            </Button>
          </>
        }
      >
        <p className="mb-3 font-medium">
          {lead.Company} <span className="text-muted">({lead["Lead ID"]})</span>
        </p>
        <Field label={T.rejectReason} htmlFor={`${ids}-reason`} help={T.rejectHelp}>
          <textarea
            id={`${ids}-reason`}
            required
            data-autofocus
            className={`${inputClass} min-h-24`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Dialog>

      <Dialog
        open={!!capOpen}
        onClose={() => setCapOpen(null)}
        title={T.capTitle}
        footer={
          <>
            <Button onClick={() => setCapOpen(null)}>{T.cancel}</Button>
            <Button variant="ok" busy={isBusy(lead, "approve_first")} onClick={() => void doApprove(true)}>
              {T.approveAnyway}
            </Button>
          </>
        }
      >
        {(capOpen ?? []).map((w) => (
          <Notice key={w} tone="warn" className="mb-2">
            {w}
          </Notice>
        ))}
        {isAdmin ? <p className="text-xs text-warn">{T.adminWarn}</p> : null}
      </Dialog>
    </article>
  );
}

export function CheckResult({ status, notes, title }: { status: string; notes: string[]; title: string }) {
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        {title} <ComplianceBadge status={status} />
      </h3>
      {notes.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ok">{T.checksOk}</p>
      )}
    </div>
  );
}
