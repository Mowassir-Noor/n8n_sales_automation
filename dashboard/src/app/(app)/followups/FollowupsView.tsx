"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { LeadRow, Settings, SuppressionRow } from "@/lib/types";
import { checkFollowup, followupSubject, recipientFor } from "@shared/email";
import { useSnapshot } from "@/components/api";
import { useLeadAction, useRole, useWf5Running, useWriteGuard } from "@/components/actions";
import { useNow } from "@/components/badges";
import { useToast } from "@/components/toast";
import {
  ago,
  fmtDateTimeIst,
  fmtRun,
  followupNumber,
  followupQueue,
  followupTab,
  languageFlag,
  nextRun,
  type FollowupTab,
} from "@/components/derive";
import { Badge, Button, Dialog, Empty, Field, Notice, Spinner, Tabs, TabPanel, inputClass } from "@/components/ui";

const T = {
  title: "Follow-ups",
  subtitle: "Sent as plain text, replying in the same thread. WF5 sends approved follow-ups on weekdays at 11:00.",
  tabsLabel: "Follow-up queue",
  tabs: { waiting: "Waiting", approved: "Approved", rewrite: "Rewrite requested", declined: "Declined" } as Record<FollowupTab, string>,
  empty: {
    waiting: "No follow-ups waiting for approval.",
    approved: "No approved follow-ups waiting to be sent.",
    rewrite: "No rewrites requested.",
    declined: "No declined follow-ups waiting for WF5 to clear them.",
  } as Record<FollowupTab, string>,
  loading: "Loading follow-ups…",
  number: (n: number) => `Follow-up ${n}`,
  drafted: (t: string) => `drafted ${t} ago`,
  original: (when: string) => `Original first email${when ? ` (sent ${when})` : ""}`,
  to: "To",
  subject: "Subject",
  realAddress: "lead's real address, not used in test mode",
  sendsAt: (t: string) => `Approved. Sends at the next WF5 run (weekday 11:00): ${t}.`,
  rewriteNote: "WF5 rewrites this draft at its next run using the note below.",
  declinedNote: "Declined. WF5 clears it at its next run and stops all remaining follow-ups for this lead.",
  approve: "Approve",
  edit: "Edit",
  rewrite: "Ask for rewrite",
  decline: "Decline",
  save: "Save",
  cancel: "Cancel",
  adminWarn: "Nil's plan says she approves; this will be logged as approved by admin.",
  checkTitle: "Live check (same rules as WF5 'Check Follow-up')",
  checkOk: "All checks pass.",
  approveOff: "Approve is off: the live check is not OK.",
  optedOut: "This lead opted out. WF5 will not send.",
  wf5Running: "WF5 is running now; changes may be too late for this run.",
  rewriteTitle: "Ask for a rewrite",
  rewriteLabel: "What should change? (saved in Nil Notes)",
  rewriteHelp: "WF5 rewrites the follow-up at its next run and asks for approval again.",
  rewriteConfirm: "Ask for rewrite",
  declineTitle: "Decline this follow-up?",
  declineBody:
    "Declining stops ALL remaining follow-ups for this lead, not just this one: WF5 clears Next Follow-up Date and the lead gets no further follow-ups. If you only want different wording, ask for a rewrite instead.",
  declineConfirm: "Decline and stop follow-ups",
  approvedToast: "Follow-up approved.",
  savedToast: "Follow-up saved. Review it, then approve.",
  rewriteToast: "Rewrite requested.",
  declinedToast: "Follow-up declined.",
  nilNotes: "Nil Notes",
  openLead: "Open lead",
  bulk: (n: number) => `Approve all (${n})`,
  bulkTitle: "Approve all waiting follow-ups",
  bulkIntro: (n: number) =>
    `Approve these ${n} follow-ups? Only follow-ups that pass the WF5 check and whose lead has not opted out are included. Each is approved separately and logged under your name; WF5 sends them at its next run (weekdays 11:00).`,
  bulkConfirm: (n: number) => `Approve ${n}`,
  bulkDone: (ok: number, n: number) => `${ok} of ${n} follow-ups approved.`,
};

export function FollowupsView() {
  const snap = useSnapshot();
  const data = snap.data;
  const now = useNow();
  const [tab, setTab] = useState<FollowupTab>("waiting");

  const groups = useMemo(() => {
    const g: Record<FollowupTab, LeadRow[]> = { waiting: [], approved: [], rewrite: [], declined: [] };
    for (const l of data ? followupQueue(data.leads) : []) {
      const t = followupTab(l);
      if (t) g[t].push(l);
    }
    for (const k of Object.keys(g) as FollowupTab[]) g[k].sort((a, b) => (a["Last Updated"] || "").localeCompare(b["Last Updated"] || ""));
    return g;
  }, [data]);

  const guard = useWriteGuard();
  const toast = useToast();
  const { run } = useLeadAction();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<{ done: number; total: number } | null>(null);
  const bulkEligible = useMemo(() => {
    if (!data) return [];
    return groups.waiting.filter(
      (l) =>
        (l["Opt-out"] || "").trim() !== "Yes" &&
        checkFollowup({ body: l["Follow-up Draft"], lead: l, settings: data.settings, suppression: data.suppression }).ok,
    );
  }, [data, groups]);
  const doBulk = async () => {
    const items = [...bulkEligible];
    setBulkBusy({ done: 0, total: items.length });
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const row = await run(items[i], "approve_followup", {});
      if (!row) break;
      ok++;
      setBulkBusy({ done: i + 1, total: items.length });
    }
    setBulkBusy(null);
    setBulkOpen(false);
    if (ok) toast.show(T.bulkDone(ok, items.length), "ok");
  };

  if (!data) {
    return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;
  }

  const list = groups[tab];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
          <p className="text-muted">{T.subtitle}</p>
        </div>
        {tab === "waiting" && bulkEligible.length > 0 ? (
          <Button size="sm" variant="ok" disabled={guard.disabled} title={guard.reason ?? undefined} onClick={() => setBulkOpen(true)}>
            {T.bulk(bulkEligible.length)}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={bulkOpen}
        onClose={() => (bulkBusy ? undefined : setBulkOpen(false))}
        title={T.bulkTitle}
        footer={
          <>
            <Button onClick={() => setBulkOpen(false)} disabled={!!bulkBusy}>
              {T.cancel}
            </Button>
            <Button variant="primary" busy={!!bulkBusy} disabled={guard.disabled} onClick={() => void doBulk()}>
              {bulkBusy ? `${bulkBusy.done}/${bulkBusy.total}` : T.bulkConfirm(bulkEligible.length)}
            </Button>
          </>
        }
      >
        <p className="mb-3">{T.bulkIntro(bulkEligible.length)}</p>
        <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">
          {bulkEligible.map((l) => (
            <li key={l["Lead ID"]}>
              {l.Company} <span className="text-muted">({l["Lead ID"]}, follow-up {followupNumber(l)})</span>
            </li>
          ))}
        </ul>
      </Dialog>
      <Tabs
        idBase="fu"
        label={T.tabsLabel}
        value={tab}
        onChange={setTab}
        items={(Object.keys(T.tabs) as FollowupTab[]).map((k) => ({ key: k, label: T.tabs[k], count: groups[k].length }))}
      />
      <TabPanel idBase="fu" value={tab} className="mt-3 space-y-4">
        {list.length === 0 ? (
          <Empty>{T.empty[tab]}</Empty>
        ) : (
          list.map((l) => <FollowupCard key={l["Lead ID"]} lead={l} tab={tab} settings={data.settings} suppression={data.suppression} now={now} />)
        )}
      </TabPanel>
    </div>
  );
}

function FollowupCard({
  lead,
  tab,
  settings,
  suppression,
  now,
}: {
  lead: LeadRow;
  tab: FollowupTab;
  settings: Settings;
  suppression: SuppressionRow[];
  now: Date;
}) {
  const ids = useId();
  const guard = useWriteGuard();
  const { isAdmin } = useRole();
  const wf5Running = useWf5Running();
  const { run, isBusy } = useLeadAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lead["Follow-up Draft"]);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);

  const body = editing ? text : lead["Follow-up Draft"];
  const check = useMemo(() => checkFollowup({ body, lead, settings, suppression }), [body, lead, settings, suppression]);
  const savedCheck = useMemo(
    () => checkFollowup({ body: lead["Follow-up Draft"], lead, settings, suppression }),
    [lead, settings, suppression],
  );
  const rcpt = recipientFor(lead, settings);
  const optedOut = (lead["Opt-out"] || "").trim() === "Yes";
  const n = followupNumber(lead);
  const off = guard.disabled;
  const canApprove = tab !== "approved" && !off && savedCheck.ok && !optedOut && !editing;

  const approve = () => run(lead, "approve_followup", {}, T.approvedToast);
  const save = async () => {
    const row = await run(lead, "edit_followup", { body: text }, T.savedToast);
    if (row) setEditing(false);
  };
  const askRewrite = async () => {
    const row = await run(lead, "rewrite_followup", { note: note.trim() }, T.rewriteToast);
    if (row) {
      setRewriteOpen(false);
      setNote("");
    }
  };
  const decline = async () => {
    const row = await run(lead, "decline_followup", {}, T.declinedToast);
    if (row) setDeclineOpen(false);
  };

  return (
    <article className="rounded-lg border border-line bg-surface" aria-labelledby={`${ids}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${ids}-h`} className="font-semibold">
            {lead.Company} <span className="text-sm font-normal text-muted">{lead["Lead ID"]}</span>
          </h2>
          <p className="text-sm text-muted">
            {languageFlag(lead.Language)} {lead["Contact Name"] || "-"}
            {lead["Contact Title"] ? `, ${lead["Contact Title"]}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{T.number(n)}</Badge>
          <Badge>{T.drafted(ago(lead["Last Updated"], now))}</Badge>
          <Link href={`/leads/${encodeURIComponent(lead["Lead ID"])}`} className="text-xs font-medium text-accent hover:underline">
            {T.openLead}
          </Link>
        </div>
      </div>

      <details className="border-b border-line px-4 py-2">
        <summary className="cursor-pointer text-sm font-medium text-muted">{T.original(fmtDateTimeIst(lead["Sent At"]))}</summary>
        <div className="mt-2 rounded-md bg-surface-2 p-3">
          <p className="mb-1 text-sm font-medium">{lead.Subject}</p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted">{lead["Draft Body"]}</pre>
        </div>
      </details>

      <div className="space-y-3 px-4 py-3">
        {tab === "approved" ? <Notice tone="ok">{T.sendsAt(fmtRun(nextRun("wf5", now), now))}</Notice> : null}
        {tab === "rewrite" ? <Notice tone="accent">{T.rewriteNote}</Notice> : null}
        {tab === "declined" ? <Notice tone="warn">{T.declinedNote}</Notice> : null}
        {optedOut ? <Notice tone="danger">{T.optedOut}</Notice> : null}
        {wf5Running ? <Notice tone="warn">{T.wf5Running}</Notice> : null}
        {lead["Nil Notes"] ? (
          <p className="text-sm">
            <span className="font-medium">{T.nilNotes}: </span>
            <span className="whitespace-pre-wrap">{lead["Nil Notes"]}</span>
          </p>
        ) : null}

        <div className="overflow-hidden rounded-md border border-line">
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 border-b border-line px-3 py-2 text-sm">
            <dt className="text-muted">{T.to}</dt>
            <dd className="min-w-0 break-words">
              <span className={rcpt.testMode ? "font-semibold text-danger" : undefined}>{rcpt.to}</span>
              {rcpt.testMode && rcpt.realTo && rcpt.realTo !== rcpt.to ? (
                <>
                  {" "}
                  <s className="text-muted" title={T.realAddress}>
                    {rcpt.realTo}
                  </s>
                </>
              ) : null}
            </dd>
            <dt className="text-muted">{T.subject}</dt>
            <dd className="min-w-0 break-words font-medium">{followupSubject(lead)}</dd>
          </dl>
          {editing ? (
            <div className="p-3">
              <label htmlFor={`${ids}-t`} className="sr-only">
                {T.edit}
              </label>
              <textarea
                id={`${ids}-t`}
                className={`${inputClass} min-h-56 font-mono text-[13px] leading-relaxed`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words px-3 py-3 font-mono text-[13px] leading-relaxed">{lead["Follow-up Draft"]}</pre>
          )}
        </div>

        <div>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            {T.checkTitle} <Badge tone={check.ok ? "ok" : "warn"}>{check.ok ? "OK" : "Needs fix"}</Badge>
          </h3>
          {check.notes.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {check.notes.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ok">{T.checkOk}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="primary" disabled={off || text === lead["Follow-up Draft"]} busy={isBusy(lead, "edit_followup")} onClick={() => void save()}>
                {T.save}
              </Button>
              <Button
                onClick={() => {
                  setEditing(false);
                  setText(lead["Follow-up Draft"]);
                }}
              >
                {T.cancel}
              </Button>
            </>
          ) : (
            <>
              {tab !== "approved" ? (
                <Button variant="ok" disabled={!canApprove} busy={isBusy(lead, "approve_followup")} onClick={() => void approve()}>
                  {T.approve}
                </Button>
              ) : null}
              <Button
                disabled={off}
                onClick={() => {
                  setText(lead["Follow-up Draft"]);
                  setEditing(true);
                }}
              >
                {T.edit}
              </Button>
              {tab !== "rewrite" ? (
                <Button disabled={off} onClick={() => setRewriteOpen(true)}>
                  {T.rewrite}
                </Button>
              ) : null}
              {tab !== "declined" ? (
                <Button variant="danger" disabled={off} onClick={() => setDeclineOpen(true)}>
                  {T.decline}
                </Button>
              ) : null}
            </>
          )}
        </div>
        {!editing && tab !== "approved" && !savedCheck.ok ? <p className="text-xs text-muted">{T.approveOff}</p> : null}
        {off && guard.reason ? <p className="text-xs text-muted">{guard.reason}</p> : null}
        {isAdmin && tab !== "approved" ? <p className="text-xs text-warn">{T.adminWarn}</p> : null}
      </div>

      <Dialog
        open={rewriteOpen}
        onClose={() => setRewriteOpen(false)}
        title={T.rewriteTitle}
        footer={
          <>
            <Button onClick={() => setRewriteOpen(false)}>{T.cancel}</Button>
            <Button variant="primary" disabled={!note.trim() || off} busy={isBusy(lead, "rewrite_followup")} onClick={() => void askRewrite()}>
              {T.rewriteConfirm}
            </Button>
          </>
        }
      >
        <Field label={T.rewriteLabel} htmlFor={`${ids}-note`} help={T.rewriteHelp}>
          <textarea id={`${ids}-note`} data-autofocus className={`${inputClass} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title={T.declineTitle}
        footer={
          <>
            <Button variant="danger" disabled={off} busy={isBusy(lead, "decline_followup")} onClick={() => void decline()}>
              {T.declineConfirm}
            </Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                setDeclineOpen(false);
                setRewriteOpen(true);
              }}
            >
              {T.rewrite}
            </Button>
          </>
        }
      >
        <Notice tone="warn">{T.declineBody}</Notice>
      </Dialog>
    </article>
  );
}
