"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { LeadRow } from "@/lib/types";
import { useLog, useSnapshot } from "@/components/api";
import { useHubspotUrl, useLeadAction, useWriteGuard } from "@/components/actions";
import { CategoryBadge, useNow } from "@/components/badges";
import { ago, fmtDateTimeIst, isHot, replyList } from "@/components/derive";
import { Badge, Button, Dialog, Empty, Field, Notice, Spinner, Tabs, TabPanel, inputClass, cx } from "@/components/ui";

const T = {
  title: "Replies",
  subtitle: "Newest first. Hot replies stay pinned at the top until someone marks them handled.",
  filter: "Filter by category",
  all: "All",
  loading: "Loading replies…",
  empty: "No replies in this category.",
  hotPinned: "Hot, not handled",
  handled: (v: string) => `Handled ${v}`,
  summary: "WF4 summary",
  replyText: "Reply text",
  replyLoading: "Loading reply text…",
  replyMissing: "No WF4 log row found for this lead.",
  showReply: "Show reply text and our email",
  ourEmail: "The email we sent",
  markHandled: "Mark handled",
  optOut: "Mark opted out",
  correct: "Correct category",
  save: "Save",
  cancel: "Cancel",
  replyMail: "Reply in mailbox",
  hubspot: "Open in HubSpot",
  openLead: "View lead",
  optOutTitle: "Mark this lead as opted out?",
  optOutBody:
    "Sets Opt-out = Yes and Stage = Opted out, clears Next Follow-up Date and adds the address to Suppression, in one step. No workflow will contact this address again.",
  optOutReason: "Reason (optional, saved in Suppression)",
  optOutConfirm: "Mark opted out",
  correctTitle: "Correct the reply category",
  correctHelp:
    "Changes Reply Category and Stage in the sheet only (Replied - Hot/Warm/Cold, or Opted out for Not interested). HubSpot is not changed.",
  category: "Category",
  handledToast: "Marked handled.",
  optedToast: "Lead opted out and added to Suppression.",
  categoryToast: "Category corrected.",
  updated: (t: string) => `${t} ago`,
};

const CATEGORIES = ["Hot", "Warm", "Cold", "Not interested", "Auto-reply"] as const;
const SETTABLE = ["Hot", "Warm", "Cold", "Not interested"] as const;
type Filter = "all" | (typeof CATEGORIES)[number];

export function RepliesView() {
  const snap = useSnapshot();
  const data = snap.data;
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");

  const all = useMemo(() => (data ? replyList(data.leads) : []), [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const l of all) c[l["Reply Category"]] = (c[l["Reply Category"]] ?? 0) + 1;
    return c;
  }, [all]);

  if (!data) return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;

  const list = filter === "all" ? all : all.filter((l) => l["Reply Category"] === filter);

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted">{T.subtitle}</p>
      </div>
      <Tabs
        idBase="rp"
        label={T.filter}
        value={filter}
        onChange={setFilter}
        items={[{ key: "all" as Filter, label: T.all, count: counts.all ?? 0 }, ...CATEGORIES.map((c) => ({ key: c as Filter, label: c, count: counts[c] ?? 0 }))]}
      />
      <TabPanel idBase="rp" value={filter} className="mt-3 space-y-3">
        {list.length === 0 ? <Empty>{T.empty}</Empty> : list.map((l) => <ReplyCard key={l["Lead ID"]} lead={l} now={now} />)}
      </TabPanel>
    </div>
  );
}

function ReplyCard({ lead, now }: { lead: LeadRow; now: Date }) {
  const ids = useId();
  const hot = isHot(lead);
  const guard = useWriteGuard();
  const { run, isBusy } = useLeadAction();
  const [open, setOpen] = useState(hot);
  const [optOpen, setOptOpen] = useState(false);
  const [optReason, setOptReason] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const [cat, setCat] = useState<string>(SETTABLE.includes(lead["Reply Category"] as (typeof SETTABLE)[number]) ? lead["Reply Category"] : "Warm");

  const optedOut = (lead["Opt-out"] || "").trim() === "Yes";
  const hubspotUrl = useHubspotUrl(lead["HubSpot Contact ID"]);
  const mailto = lead.Email
    ? `mailto:${encodeURIComponent(lead.Email)}?subject=${encodeURIComponent(/^re:/i.test(lead.Subject) ? lead.Subject : `Re: ${lead.Subject}`)}`
    : null;

  return (
    <article
      aria-labelledby={`${ids}-h`}
      className={cx("rounded-lg border bg-surface", hot ? "border-danger/60 ring-1 ring-danger/20" : "border-line")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${ids}-h`} className="font-semibold">
            {lead.Company} <span className="text-sm font-normal text-muted">{lead["Lead ID"]}</span>
          </h2>
          <p className="text-sm text-muted">
            {lead["Contact Name"] || "-"}
            {lead.Email ? ` · ${lead.Email}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hot ? <Badge tone="danger">{T.hotPinned}</Badge> : null}
          <CategoryBadge category={lead["Reply Category"]} />
          <Badge>{lead.Stage}</Badge>
          <span className="text-xs text-muted">{T.updated(ago(lead["Last Updated"], now))}</span>
        </div>
      </div>
      <div className="space-y-3 border-t border-line px-4 py-3">
        <div>
          <h3 className="text-xs font-medium text-muted">{T.summary}</h3>
          <p className="whitespace-pre-wrap">{lead["Reply Summary"] || "-"}</p>
        </div>
        {lead["Hot Handled"] ? <p className="text-xs text-muted">{T.handled(fmtHandled(lead["Hot Handled"]))}</p> : null}

        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${ids}-more`}
            onClick={() => setOpen((v) => !v)}
            className="text-sm font-medium text-accent hover:underline"
          >
            {open ? "▾" : "▸"} {T.showReply}
          </button>
          {open ? (
            <div id={`${ids}-more`} className="mt-2 space-y-3">
              <ReplyText leadId={lead["Lead ID"]} />
              <details>
                <summary className="cursor-pointer text-xs font-medium text-muted">{T.ourEmail}</summary>
                <div className="mt-1 rounded-md bg-surface-2 p-3">
                  <p className="mb-1 text-sm font-medium">{lead.Subject}</p>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted">{lead["Draft Body"]}</pre>
                </div>
              </details>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {hot ? (
            <Button
              variant="primary"
              disabled={guard.disabled}
              busy={isBusy(lead, "mark_hot_handled")}
              onClick={() => void run(lead, "mark_hot_handled", {}, T.handledToast)}
            >
              {T.markHandled}
            </Button>
          ) : null}
          <Button disabled={guard.disabled} onClick={() => setCatOpen(true)}>
            {T.correct}
          </Button>
          {!optedOut ? (
            <Button variant="danger" disabled={guard.disabled} onClick={() => setOptOpen(true)}>
              {T.optOut}
            </Button>
          ) : null}
{hubspotUrl ? (
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-accent hover:bg-surface-2"
            >
              {T.hubspot}
            </a>
          ) : null}
          {mailto ? (
            <a href={mailto} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-accent hover:bg-surface-2">
              {T.replyMail}
            </a>
          ) : null}
          <Link
            href={`/leads/${encodeURIComponent(lead["Lead ID"])}`}
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-accent hover:bg-surface-2"
          >
            {T.openLead}
          </Link>
        </div>
      </div>

      <Dialog
        open={optOpen}
        onClose={() => setOptOpen(false)}
        title={T.optOutTitle}
        footer={
          <>
            <Button onClick={() => setOptOpen(false)}>{T.cancel}</Button>
            <Button
              variant="danger"
              disabled={guard.disabled}
              busy={isBusy(lead, "opt_out")}
              onClick={async () => {
                const row = await run(lead, "opt_out", { note: optReason.trim() || "reply" }, T.optedToast);
                if (row) setOptOpen(false);
              }}
            >
              {T.optOutConfirm}
            </Button>
          </>
        }
      >
        <Notice tone="warn" className="mb-3">
          {T.optOutBody}
        </Notice>
        <Field label={T.optOutReason} htmlFor={`${ids}-or`}>
          <input id={`${ids}-or`} className={inputClass} value={optReason} onChange={(e) => setOptReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={catOpen}
        onClose={() => setCatOpen(false)}
        title={T.correctTitle}
        footer={
          <>
            <Button onClick={() => setCatOpen(false)}>{T.cancel}</Button>
            <Button
              variant="primary"
              disabled={guard.disabled || cat === lead["Reply Category"]}
              busy={isBusy(lead, "set_reply_category")}
              onClick={async () => {
                const row = await run(lead, "set_reply_category", { category: cat as (typeof SETTABLE)[number] }, T.categoryToast);
                if (row) setCatOpen(false);
              }}
            >
              {T.save}
            </Button>
          </>
        }
      >
        <Field label={T.category} htmlFor={`${ids}-cat`} help={T.correctHelp}>
          <select id={`${ids}-cat`} className={inputClass} value={cat} onChange={(e) => setCat(e.target.value)}>
            {SETTABLE.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </Dialog>
    </article>
  );
}

/** The reply text is the Input of the lead's WF4 'Reply triage' Log row (first 1,500 characters). */
function ReplyText({ leadId }: { leadId: string }) {
  const log = useLog({ leadId, pageSize: 100 });
  if (log.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> {T.replyLoading}
      </p>
    );
  }
  const rows = (log.data?.rows ?? []).filter((r) => r.Workflow.startsWith("WF4") || r.Step === "Reply triage");
  if (!rows.length) return <p className="text-sm text-muted">{T.replyMissing}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i}>
          <h3 className="text-xs font-medium text-muted">
            {T.replyText} · {fmtDateTimeIst(r.Timestamp)}
          </h3>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line p-3 font-sans text-sm">
            {r.Input.slice(0, 1500)}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** "<ISO> by <email>" -> "14 Nov 2026, 16:20 by <email>". */
function fmtHandled(v: string): string {
  const i = v.indexOf(" by ");
  if (i < 0) return fmtDateTimeIst(v);
  return `${fmtDateTimeIst(v.slice(0, i))}${v.slice(i)}`;
}
