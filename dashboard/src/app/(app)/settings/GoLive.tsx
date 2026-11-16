"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { LeadRow, Settings, SettingsWriteRequest } from "@/lib/types";
import { newRequestId, postJson, SNAPSHOT_KEY, useSnapshot } from "@/components/api";
import { useLeadAction, useWriteGuard } from "@/components/actions";
import { useFeedback } from "@/components/feedback";
import { StageBadge } from "@/components/badges";
import { fmtDateTimeIst, isTestMode, testSentList } from "@/components/derive";
import { Button, Card, Dialog, Notice, inputClass } from "@/components/ui";

const T = {
  title: "Go live",
  intro: (addr: string) =>
    `Test mode is on: every first email goes to ${addr}. Going live clears Test Email, so the next WF3 run sends to real leads.`,
  notTest: "Test mode is off: emails already go to the leads.",
  checklist: "Checklist",
  items: [
    "Mail Provider and SMTP From match the nodes enabled in n8n.",
    "The opt-out sentences (TR and EN) and the signature are correct in a preview.",
    "HubSpot limit and pause share are set.",
    "A Seed Email is set to watch inbox placement for the first live sends.",
    "Nil has reviewed the approved drafts (they send at the next WF3 run after going live).",
  ],
  listTitle: "Leads sent in test mode",
  listIntro:
    "These leads were 'sent' to the test address and still have follow-ups scheduled. Once live, WF5 would send follow-up 1 to the real prospect, who never got the first email. Decide each one first.",
  listEmpty: "No test-sent leads left.",
  reset: "Reset to Drafted",
  close: "Close",
  resetTitle: "Reset to Drafted?",
  resetBody:
    "Clears Sent At, Gmail Thread ID, Follow-up Count, Next Follow-up Date and Follow-up Draft, sets Stage = Drafted and Approved = Pending. The draft goes back into the first-email queue.",
  closeTitle: "Close this lead?",
  closeBody: "Sets Stage = Closed - No reply and clears Next Follow-up Date and Follow-up Draft. No more emails to this lead.",
  confirm: "Confirm",
  cancel: "Cancel",
  blocked: (n: number) => `Go-live is blocked until the list above is empty (${n} left).`,
  typeLabel: (w: string) => `Type ${w} to confirm`,
  word: "GO LIVE",
  button: "Go live: clear Test Email",
  done: "Live. Test Email is cleared; the next WF3 run sends to real leads.",
  resetDone: "Reset to Drafted.",
  closeDone: "Closed.",
  sentAt: "Sent at",
};

export function GoLive() {
  const snap = useSnapshot();
  const data = snap.data;
  const guard = useWriteGuard();
  const fb = useFeedback();
  const qc = useQueryClient();
  const { run, isBusy } = useLeadAction();
  const [checks, setChecks] = useState<boolean[]>(() => T.items.map(() => false));
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<{ lead: LeadRow; kind: "reset" | "close" } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const settings: Settings = data.settings;
  if (!isTestMode(settings)) {
    return (
      <Card className="p-4">
        <h2 className="mb-1 font-semibold">{T.title}</h2>
        <p className="text-muted">{T.notTest}</p>
      </Card>
    );
  }
  const list = testSentList(data.leads, settings);
  const ready = list.length === 0 && checks.every(Boolean) && typed.trim() === T.word && !guard.disabled;

  const goLive = async () => {
    setBusy(true);
    try {
      const req: SettingsWriteRequest = {
        expect: { "Test Email": settings["Test Email"] },
        data: { "Test Email": "" },
        requestId: newRequestId(),
      };
      const res = await postJson("/api/settings", req, { "X-Go-Live": "confirm" });
      if (fb.handle(res, { success: T.done })) {
        setTyped("");
        void qc.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const row = await run(
      pending.lead,
      pending.kind === "reset" ? "reset_test_sent" : "close_test_sent",
      {},
      pending.kind === "reset" ? T.resetDone : T.closeDone,
    );
    if (row) setPending(null);
  };

  return (
    <Card className="border-danger/40 p-4">
      <h2 className="mb-1 font-semibold">{T.title}</h2>
      <p className="mb-4 text-muted">{T.intro(settings["Test Email"])}</p>

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-semibold">{T.checklist}</legend>
        <ul className="space-y-1.5">
          {T.items.map((item, i) => (
            <li key={i}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                  checked={checks[i]}
                  onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                {item}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <h3 className="mb-1 text-sm font-semibold">
        {T.listTitle} ({list.length})
      </h3>
      <p className="mb-2 text-sm text-muted">{T.listIntro}</p>
      {list.length === 0 ? (
        <Notice tone="ok" className="mb-4">
          {T.listEmpty}
        </Notice>
      ) : (
        <ul className="mb-4 divide-y divide-line rounded-md border border-line">
          {list.map((l) => (
            <li key={l["Lead ID"]} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <Link href={`/leads/${encodeURIComponent(l["Lead ID"])}`} className="font-medium hover:underline">
                  {l.Company}
                </Link>{" "}
                <span className="text-xs text-muted">{l["Lead ID"]}</span>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StageBadge stage={l.Stage} />
                  <span>
                    {T.sentAt} {fmtDateTimeIst(l["Sent At"])}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={guard.disabled} busy={isBusy(l, "reset_test_sent")} onClick={() => setPending({ lead: l, kind: "reset" })}>
                  {T.reset}
                </Button>
                <Button size="sm" variant="danger" disabled={guard.disabled} busy={isBusy(l, "close_test_sent")} onClick={() => setPending({ lead: l, kind: "close" })}>
                  {T.close}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.length ? (
        <Notice tone="warn" className="mb-3">
          {T.blocked(list.length)}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56">
          <label htmlFor="golive-typed" className="mb-1 block text-xs font-medium">
            {T.typeLabel(T.word)}
          </label>
          <input
            id="golive-typed"
            className={inputClass}
            value={typed}
            disabled={list.length > 0}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button variant="danger" disabled={!ready} busy={busy} onClick={() => void goLive()}>
          {T.button}
        </Button>
      </div>

      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.kind === "reset" ? T.resetTitle : T.closeTitle}
        footer={
          <>
            <Button onClick={() => setPending(null)}>{T.cancel}</Button>
            <Button
              variant={pending?.kind === "close" ? "danger" : "primary"}
              busy={!!pending && isBusy(pending.lead)}
              disabled={guard.disabled}
              onClick={() => void confirmPending()}
            >
              {T.confirm}
            </Button>
          </>
        }
      >
        {pending ? (
          <>
            <p className="mb-2 font-medium">
              {pending.lead.Company} <span className="text-muted">({pending.lead["Lead ID"]})</span>
            </p>
            <p className="text-sm">{pending.kind === "reset" ? T.resetBody : T.closeBody}</p>
          </>
        ) : null}
      </Dialog>
    </Card>
  );
}
