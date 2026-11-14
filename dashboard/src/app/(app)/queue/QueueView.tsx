"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LeadRow } from "@/lib/types";
import { checkDraft } from "@shared/email";
import { useSnapshot } from "@/components/api";
import { useToast } from "@/components/toast";
import { useLeadAction, useWriteGuard } from "@/components/actions";
import { ComplianceBadge, useNow } from "@/components/badges";
import {
  ago,
  approvedSendTimes,
  capStatus,
  firstEmailQueue,
  fmtRun,
  hubspotUsage,
  languageFlag,
  SOFT_CAPS,
  type FirstEmailTab,
} from "@/components/derive";
import { Button, Dialog, Empty, Notice, Spinner, Tabs, TabPanel, cx } from "@/components/ui";
import { FirstEmailDetail, type DetailCommands } from "./FirstEmailDetail";

const T = {
  title: "First emails",
  tabs: { waiting: "Waiting", approved: "Approved (sends at next run)", rejected: "Rejected" } as Record<FirstEmailTab, string>,
  tabsLabel: "First-email queue",
  loading: "Loading drafts…",
  empty: {
    waiting: "Nothing waiting. New drafts arrive after WF2 runs (weekdays 09:00).",
    approved: "No approved drafts waiting to be sent.",
    rejected: "No rejected drafts.",
  } as Record<FirstEmailTab, string>,
  waited: (t: string) => `waited ${t}`,
  sends: (t: string) => `sends ${t}`,
  noContact: "No contact name",
  bulk: (n: number) => `Approve ${n} OK drafts`,
  bulkTitle: "Approve several drafts",
  bulkIntro: (n: number) =>
    `Approve ${n} drafts that pass every check and have not been edited? Each one is approved separately and logged under your name.`,
  bulkConfirm: (n: number) => `Approve ${n}`,
  bulkDone: (ok: number, n: number) => `${ok} of ${n} approved.`,
  cancel: "Cancel",
  hubspotPaused: (pct: number, at: number) =>
    `HubSpot estimate is at ${pct}% of this month's limit (WF3 pauses at ${at}%). Approved emails will not send until the estimate is below that share or the limit is raised.`,
  keys: "Keys: J/K next/previous, A approve, E edit, R reject",
  back: "Back to list",
  list: "Drafts",
};

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function QueueView() {
  const sp = useSearchParams();
  const snap = useSnapshot();
  const data = snap.data;
  const now = useNow();
  const guard = useWriteGuard();
  const { run } = useLeadAction();
  const toast = useToast();

  const [tab, setTab] = useState<FirstEmailTab>(() => {
    const t = sp.get("tab");
    return t === "approved" || t === "rejected" ? t : "waiting";
  });
  const [picked, setPicked] = useState<string | null>(sp.get("id"));
  const deepLinked = useRef(false);

  const queue = useMemo(() => {
    const q = data ? firstEmailQueue(data.leads) : { waiting: [], approved: [], rejected: [] };
    const byWait = (a: LeadRow, b: LeadRow) => (a["Last Updated"] || "").localeCompare(b["Last Updated"] || "");
    return {
      waiting: [...q.waiting].sort(byWait),
      approved: [...q.approved].sort((a, b) => (a.row_number ?? 0) - (b.row_number ?? 0)),
      rejected: [...q.rejected].sort(byWait),
    };
  }, [data]);
  const sendTimes = useMemo(() => (data ? approvedSendTimes(data.leads, now) : new Map<string, Date>()), [data, now]);

  // A deep link (?id=L013) opens the tab that holds the lead.
  useEffect(() => {
    if (deepLinked.current || !data || !picked) return;
    deepLinked.current = true;
    for (const k of ["waiting", "approved", "rejected"] as FirstEmailTab[]) {
      if (queue[k].some((l) => l["Lead ID"] === picked)) {
        setTab(k);
        return;
      }
    }
  }, [data, picked, queue]);

  const list = queue[tab];
  const selected = list.find((l) => l["Lead ID"] === picked) ?? null;
  const shown = selected ?? list[0] ?? null;
  const shownIdx = shown ? list.indexOf(shown) : -1;

  const move = useCallback(
    (delta: number) => {
      if (!list.length) return;
      const i = shownIdx < 0 ? 0 : Math.min(list.length - 1, Math.max(0, shownIdx + delta));
      setPicked(list[i]["Lead ID"]);
      document.getElementById(`q-item-${list[i]["Lead ID"]}`)?.scrollIntoView({ block: "nearest" });
    },
    [list, shownIdx],
  );

  /** After an action moves the row to another tab, select its neighbour. */
  const afterAction = useCallback(() => {
    if (shownIdx < 0) return;
    const next = list[shownIdx + 1] ?? list[shownIdx - 1] ?? null;
    setPicked(next ? next["Lead ID"] : null);
  }, [list, shownIdx]);

  const commands = useRef<DetailCommands | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        move(1);
      } else if (k === "k") {
        e.preventDefault();
        move(-1);
      } else if (k === "a" && commands.current?.approve) {
        e.preventDefault();
        commands.current.approve();
      } else if (k === "e" && commands.current?.edit) {
        e.preventDefault();
        commands.current.edit();
      } else if (k === "r" && commands.current?.reject) {
        e.preventDefault();
        commands.current.reject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  // ---- Bulk approve: OK on the sheet AND on the live re-check, never edited, not opted out ----
  const bulkEligible = useMemo(() => {
    if (!data) return [];
    return queue.waiting.filter((l) => {
      if (l["Compliance Status"] !== "OK") return false;
      if (l.Approved === "Edit") return false;
      if ((l["Opt-out"] || "").trim() === "Yes") return false;
      // edit_first clears Draft Body EN; a Turkish draft without it has been edited in the dashboard.
      if ((l.Language || "").trim().toLowerCase() === "tr" && !(l["Draft Body EN"] || "").trim()) return false;
      const c = checkDraft({ subject: l.Subject, body: l["Draft Body"], lead: l, settings: data.settings, suppression: data.suppression });
      return c.status === "OK";
    });
  }, [data, queue.waiting]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<{ done: number; total: number } | null>(null);
  const bulkWarnings = data ? capStatus(data.leads, SOFT_CAPS, now, bulkEligible.length).warnings : [];

  const doBulk = async () => {
    const items = [...bulkEligible];
    setBulkBusy({ done: 0, total: items.length });
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const row = await run(items[i], "approve_first", {});
      if (!row) break;
      ok++;
      setBulkBusy({ done: i + 1, total: items.length });
    }
    setBulkBusy(null);
    setBulkOpen(false);
    setPicked(null);
    if (ok) toast.show(T.bulkDone(ok, items.length), "ok");
  };

  const hubspot = data ? hubspotUsage(data.leads, data.settings, now) : null;

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-muted">
        {snap.isError ? null : <Spinner />} {snap.isError ? null : T.loading}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted lg:inline">{T.keys}</span>
          {tab === "waiting" && bulkEligible.length > 1 ? (
            <Button size="sm" variant="secondary" disabled={guard.disabled} title={guard.reason ?? undefined} onClick={() => setBulkOpen(true)}>
              {T.bulk(bulkEligible.length)}
            </Button>
          ) : null}
        </div>
      </div>

      {hubspot?.paused ? (
        <Notice tone="warn" className="mb-3">
          {T.hubspotPaused(hubspot.percent, hubspot.pauseAt)}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <section aria-label={T.list} className={cx("min-w-0", selected ? "hidden lg:block" : "block")}>
          <Tabs
            idBase="fq"
            label={T.tabsLabel}
            value={tab}
            onChange={(k) => {
              setTab(k);
              setPicked(null);
            }}
            items={(["waiting", "approved", "rejected"] as FirstEmailTab[]).map((k) => ({ key: k, label: T.tabs[k], count: queue[k].length }))}
            size="sm"
          />
          <TabPanel idBase="fq" value={tab} className="mt-2">
            {list.length === 0 ? (
              <Empty>{T.empty[tab]}</Empty>
            ) : (
              <ul className="space-y-1.5 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:pr-1">
                {list.map((l) => {
                  const active = shown?.["Lead ID"] === l["Lead ID"];
                  const send = sendTimes.get(l["Lead ID"]);
                  return (
                    <li key={l["Lead ID"]}>
                      <button
                        id={`q-item-${l["Lead ID"]}`}
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => setPicked(l["Lead ID"])}
                        className={cx(
                          "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                          active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{l.Company || l["Lead ID"]}</span>
                          <ComplianceBadge status={l["Compliance Status"]} />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                          <span className="min-w-0 truncate">
                            <span aria-label={`Language ${l.Language}`}>{languageFlag(l.Language)}</span> {l["Contact Name"] || T.noContact}
                          </span>
                          <span className="shrink-0">
                            {tab === "approved" && send ? T.sends(fmtRun(send, now)) : T.waited(ago(l["Last Updated"], now))}
                          </span>
                        </div>
                        {tab === "rejected" && l["Nil Notes"] ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted">{l["Nil Notes"]}</p>
                        ) : null}
                        {l.Approved === "Edit" ? <p className="mt-1 text-xs text-warn">Marked for edit</p> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabPanel>
        </section>

        <section className={cx("min-w-0", selected ? "block" : "hidden lg:block")}>
          {shown ? (
            <FirstEmailDetail
              key={shown["Lead ID"]}
              lead={shown}
              tab={tab}
              snapshot={data}
              now={now}
              sendAt={sendTimes.get(shown["Lead ID"])}
              commands={commands}
              onDone={afterAction}
              onSkip={() => move(1)}
              onBack={() => setPicked(null)}
              backLabel={T.back}
            />
          ) : null}
        </section>
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
        <ul className="mb-3 max-h-48 list-disc overflow-y-auto pl-5 text-sm">
          {bulkEligible.map((l) => (
            <li key={l["Lead ID"]}>
              {l.Company} <span className="text-muted">({l["Lead ID"]})</span>
            </li>
          ))}
        </ul>
        {bulkWarnings.map((w) => (
          <Notice key={w} tone="warn" className="mb-2">
            {w}
          </Notice>
        ))}
      </Dialog>
    </div>
  );
}

